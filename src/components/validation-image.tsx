"use client";

import { useConfirm } from "@/components/ui/confirmation";
import Image from "next/image";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { MAX_IMAGE_BYTES } from "@/features/images/limits";

const subscribe = () => () => {};

export function ValidationImage({ id, hasImage, alt, width, height, size, version, active }: {
  id: string; hasImage: boolean; alt: string; width: number | null; height: number | null; size: number | null; version: string; active: boolean;
}) {
  const confirm = useConfirm();
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const endpoint = `/api/validations/${id}/image`;

  async function upload() {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { setFeedback({ error: true, message: "La imagen supera el límite de 10 MiB." }); return; }
    await send("POST", file);
  }
  async function remove() {
    const message = active
      ? "¿Eliminar la imagen? La validación también quedará desactivada en la misma operación."
      : "¿Eliminar la imagen de esta validación?";
    if (await confirm(message)) await send("DELETE");
  }
  async function send(method: "POST" | "DELETE", selected?: File) {
    setPending(true); setFeedback(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(selected ? `${endpoint}?filename=${encodeURIComponent(selected.name)}` : endpoint, {
        method, body: selected,
        headers: selected ? { "Content-Type": selected.type || "application/octet-stream" } : { "X-Confirm-Deactivation": active ? "true" : "false" },
        signal: controller.signal,
      });
      const result: { message?: string } = await response.json();
      setFeedback({ error: !response.ok, message: result.message || "No se pudo completar la operación." });
      if (response.status === 409) router.refresh();
      if (response.ok) {
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
        router.refresh();
      }
    } catch { setFeedback({ error: true, message: "No se pudo completar la conexión. Comprueba la imagen actual antes de volver a intentarlo." }); }
    finally { clearTimeout(timeout); setPending(false); }
  }

  return <section className="image-section surface" id="imagen" aria-labelledby="image-title">
    <div className="section-line"><h2 id="image-title">Imagen de resultado</h2><span>{hasImage ? "Imagen cargada" : "Sin imagen"}</span></div>
    <p className="help">Carga la imagen que se mostrará cuando el folio sea válido. Puedes reemplazarla más adelante.</p>
    {hasImage ? <div className="image-preview">
      <Image src={`${endpoint}?v=${encodeURIComponent(version)}`} width={width ?? 400} height={height ?? 300} alt={alt} unoptimized onError={() => setPreviewError(true)} onLoad={() => setPreviewError(false)} />
      {previewError && <p role="alert" className="feedback error">La imagen no se pudo mostrar. Intenta cargarla de nuevo.</p>}
      <p className="help">{width} × {height} píxeles{size ? ` · ${Math.round(size / 1024)} KiB` : ""}</p>
    </div> : <div className="image-empty"><ImagePlus size={28} aria-hidden="true" /><p>Aún no has cargado una imagen.</p></div>}
    <div className="field"><label htmlFor="validation-image-file">{hasImage ? "Reemplazar imagen" : "Seleccionar imagen"}</label><input ref={fileInput} id="validation-image-file" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={!ready || pending} aria-describedby="image-file-help" onChange={event => { setFile(event.target.files?.[0] ?? null); setFeedback(null); }} /><p className="help" id="image-file-help">JPG, JPEG, PNG o WebP estática. Máximo 10 MiB y 20 millones de píxeles.</p></div>
    <div className="form-controls"><button type="button" className="button" disabled={!file || pending || !ready} onClick={upload}>{pending ? "Procesando…" : hasImage ? "Guardar nueva imagen" : "Cargar imagen"}</button>{hasImage && <button type="button" className="button button-secondary danger-button" disabled={pending} onClick={remove}>Eliminar imagen</button>}</div>
    <div aria-live="polite" role={feedback?.error ? "alert" : "status"}>{feedback && <p className={`feedback ${feedback.error ? "error" : "success"}`}>{feedback.message}</p>}</div>
  </section>;
}
