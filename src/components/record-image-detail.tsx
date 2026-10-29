"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ImagePlus, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import type { CatalogRow } from "@/features/records/catalog-query";
import { MAX_IMAGE_BYTES } from "@/features/images/limits";
import { CatalogImage } from "./catalog-image";
import { RecordImageDelete } from "./record-image-delete";
import { useConfirm } from "./ui/confirmation";

export function RecordImageDetail({ row, validationId, active, onClose, restoreFocus }: { row: CatalogRow; validationId: string; active: boolean; onClose: () => void; restoreFocus: () => void }) {
  const router = useRouter(), confirm = useConfirm();
  const [zoom, setZoom] = useState(1), [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState("");
  const [pending, setPending] = useState(false), [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const image = row.image;
  if (!image) return null;
  const endpoint = `/api/validations/${validationId}/images/${image.id}`;
  async function copy(value: string, name: string) {
    try { await navigator.clipboard.writeText(value); setFeedback({ error: false, message: `${name} copiado: ${value}` }); }
    catch { setFeedback({ error: true, message: `No se pudo copiar. Selecciona el texto y cópialo: ${value}` }); }
  }
  async function replace() {
    if (!file || !image) return;
    if (!await confirm(`¿Reemplazar la imagen de ${row.alfanum}? Las nuevas consultas mostrarán el nuevo archivo. El alfanumérico y el folio se conservan.`)) return;
    setPending(true); setFeedback(null);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(`${endpoint}?filename=${encodeURIComponent(file.name)}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-Image-Version": new Date(image.updatedAt).toISOString() }, signal: controller.signal });
      const result = await response.json();
      setFeedback({ error: !response.ok, message: result.message || "No se pudo completar la operación." });
      if (response.ok) { setFile(null); setPreview(""); setZoom(1); if (input.current) input.current.value = ""; }
      if (response.ok || response.status === 409) router.refresh();
    } catch { setFeedback({ error: true, message: "Se interrumpió la conexión. Revisa la imagen actual antes de volver a reemplazarla." }); }
    finally { clearTimeout(timeout); setPending(false); }
  }
  return <Dialog.Root open onOpenChange={open => { if (!open && !pending) onClose(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay catalog-detail-overlay" /><Dialog.Content className="catalog-detail" onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onPointerDownOutside={event => { if (pending) event.preventDefault(); }}>
    <header className="catalog-detail-heading"><div><Dialog.Title>Imagen de {row.alfanum}</Dialog.Title><Dialog.Description>Revisa el archivo y su relación con la base publicada.</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" disabled={pending} aria-label="Cerrar detalle de imagen"><X size={20} aria-hidden="true" /></button></Dialog.Close></header>
    <div className="catalog-detail-body"><div className="catalog-preview-toolbar"><span>Vista del documento</span><div><button className="icon-button" aria-label="Alejar vista previa" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}><ZoomOut size={18} aria-hidden="true" /></button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button className="icon-button" aria-label="Acercar vista previa" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .5))}><ZoomIn size={18} aria-hidden="true" /></button><button className="icon-button" aria-label="Ajustar vista previa" onClick={() => setZoom(1)}><RotateCcw size={17} aria-hidden="true" /></button></div></div>
    <div className="catalog-detail-preview" tabIndex={0} role="region" aria-label="Vista previa desplazable de la imagen"><div style={{ width: `${zoom * 100}%` }}><CatalogImage key={new Date(image.updatedAt).toISOString()} src={`${endpoint}?v=${encodeURIComponent(new Date(image.updatedAt).toISOString())}`} alt={`Documento de ${row.alfanum}`} width={image.width} height={image.height} detail /></div></div>
    <p className="help">Amplía con los controles y desplázate dentro de la vista para revisar los detalles.</p>
    <dl className="catalog-detail-metadata"><div><dt>Alfanumérico</dt><dd>{row.alfanum}<button className="icon-button" aria-label="Copiar alfanumérico" onClick={() => copy(row.alfanum, "Alfanumérico")}><Copy size={16} aria-hidden="true" /></button></dd></div><div><dt>Folio</dt><dd>{row.folio ?? "Sin registro publicado"}{row.folio !== null && <button className="icon-button" aria-label="Copiar folio" onClick={() => copy(row.folio!, "Folio")}><Copy size={16} aria-hidden="true" /></button>}</dd></div><div><dt>Tipo de documento</dt><dd>{row.tipo ?? "—"}</dd></div><div><dt>Archivo original</dt><dd>{image.originalName}</dd></div><div><dt>Dimensiones y tamaño</dt><dd>{image.width} × {image.height} px · {Math.ceil(image.size / 1024).toLocaleString("es-MX")} KiB</dd></div><div><dt>Fecha de carga</dt><dd>{new Date(image.createdAt).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", year: "numeric" })}</dd></div></dl>
    <details className="catalog-manage"><summary>Gestionar imagen</summary><div className="stack"><p className="help">Reemplazar conserva la asociación. Para cambiar folio o tipo, actualiza la base desde Registros.</p><div className="field"><label htmlFor="record-image-file">Seleccionar nueva imagen</label><input id="record-image-file" ref={input} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={pending} aria-describedby="record-image-file-help" onChange={event => { const selected = event.target.files?.[0] ?? null; setFeedback(null); setPreview(""); if (selected && selected.size > MAX_IMAGE_BYTES) { setFile(null); event.target.value = ""; setFeedback({ error: true, message: "La imagen supera el límite de 10 MiB." }); } else { setFile(selected); if (selected) setPreview(URL.createObjectURL(selected)); } }} /><p id="record-image-file-help" className="help">JPG, JPEG, PNG o WebP estática · hasta 10 MiB y 20 millones de píxeles.</p></div>{preview && <div className="catalog-replacement-preview"><p className="help">Archivo seleccionado: {file?.name}</p><Image src={preview} width={600} height={400} alt="Vista previa del reemplazo seleccionado" unoptimized /></div>}<button className="button" disabled={!file || pending} onClick={replace}><ImagePlus size={17} aria-hidden="true" />{pending ? "Reemplazando…" : "Reemplazar imagen"}</button><div className="catalog-delete-zone"><p>{active ? "Eliminar esta imagen también desactivará la validación pública." : "Eliminar retira el archivo de esta validación."}</p><RecordImageDelete validationId={validationId} imageId={image.id} name={image.originalName} active={active} disabled={pending} onDeleted={onClose} /></div></div></details>
    {feedback && <p className={`feedback ${feedback.error ? "error" : "success"}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    </div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
