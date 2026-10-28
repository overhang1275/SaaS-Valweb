"use client";

import { UploadCloud, ChevronDown } from "lucide-react";
import { useConfirm } from "@/components/ui/confirmation";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { jobDto } from "@/features/imports/service";
import { useHydrated } from "@/lib/use-hydrated";

type Job = ReturnType<typeof jobDto>;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function ImportPanel({ id, imageMode, initial }: { id: string; imageMode: "SHARED" | "PER_RECORD"; initial: Job[] }) {
  const confirm = useConfirm();
  const router = useRouter();
  const ready = useHydrated();
  const [jobs, setJobs] = useState(initial);
  const [kind, setKind] = useState<"CSV" | "IMAGES">("CSV");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [replace, setReplace] = useState(false);
  const [upload, setUpload] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [uploadError, setUploadError] = useState(false);
  const busy = jobs.some(job => job.status === "QUEUED" || job.status === "PROCESSING");
  async function refresh() {
    const response = await fetch(`/api/validations/${id}/imports`, { cache: "no-store" });
    if (response.ok) setJobs(await response.json());
  }
  useEffect(() => {
    if (!busy) return;
    const interval = setInterval(() => {
      void fetch(`/api/validations/${id}/imports`, { cache: "no-store" }).then(response => response.ok ? response.json() : null).then((updated: Job[] | null) => {
        if (updated) { setJobs(updated); if (!updated.some(job => job.status === "QUEUED" || job.status === "PROCESSING")) router.refresh(); }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [busy, id, router]);
  async function send() {
    if (!file) return;
    setUpload(0); setMessage(""); setUploadError(false);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/validations/${id}/imports?kind=${kind}&filename=${encodeURIComponent(file.name)}&replace=${replace}`);
    xhr.upload.onprogress = event => { if (event.lengthComputable) setUpload(Math.round(event.loaded * 100 / event.total)); };
    xhr.onerror = () => { setUploadError(true); setUpload(null); setMessage("Se interrumpió la recepción. Revisa la conexión antes de volver a subir el archivo."); };
    xhr.onload = () => {
      setUpload(null);
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status === 202) { setJobs(previous => [response as Job, ...previous].slice(0, 10)); setFile(null); if (fileInput.current) fileInput.current.value = ""; setMessage("Archivo recibido. Puedes salir de esta pantalla mientras se procesa."); }
        else { setUploadError(true); setMessage(response.message || "No se pudo recibir la carga."); }
      } catch { setUploadError(true); setMessage("No se pudo recibir la carga."); }
    };
    xhr.send(file);
  }
  async function command(job: Job, input: object) {
    setMessage("");
    try {
      const response = await fetch(`/api/imports/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) { setUploadError(true); setMessage(result.message || "No se pudo completar la operación."); }
      await refresh(); router.refresh();
    } catch { setUploadError(true); setMessage("No se pudo conectar. La importación conserva su estado; vuelve a consultar el avance."); }
  }
  return <section className="bulk-section surface" aria-labelledby="bulk-title"><h2 id="bulk-title">Carga masiva de registros e imágenes</h2><p className="help">CSV: folio, alfanum, tipo y otro. ZIP: imágenes como 4frs5.png. Se validan en segundo plano; los datos actuales se conservan hasta publicar.</p>
    <div className="stack bulk-upload"><div className="field"><label htmlFor="import-kind">Tipo de carga</label><select id="import-kind" value={kind} disabled={!ready || upload !== null} onChange={event => { setKind(event.target.value as "CSV" | "IMAGES"); setFile(null); }}><option value="CSV">Registros CSV</option>{imageMode === "PER_RECORD" && <option value="IMAGES">Imágenes ZIP o imagen individual</option>}</select></div>
    <div className="field upload-dropzone"><UploadCloud size={28} aria-hidden="true" /><label htmlFor="import-file">{kind === "CSV" ? "Archivo CSV" : "Archivo ZIP o imagen"}</label><input ref={fileInput} key={kind} id="import-file" type="file" accept={kind === "CSV" ? ".csv" : ".zip,.jpg,.jpeg,.png,.webp"} disabled={!ready || upload !== null} onChange={event => setFile(event.target.files?.[0] ?? null)} /><p className="help">{kind === "CSV" ? "UTF-8 con encabezados. Máximo 100 MiB. El mapeo de columnas se confirma después de recibirlo." : "Hasta 50,000 imágenes por lote. Nombres alfanuméricos, máximo 10 MiB por imagen. El ZIP se procesa archivo por archivo."}</p></div>
    {kind === "IMAGES" && <label className="checkbox-row"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />Reemplazar imágenes de alfanuméricos existentes</label>}
    <div><button type="button" className="button" disabled={!file || upload !== null} onClick={send}>{upload === null ? "Subir archivo" : `Recibiendo ${upload}%`}</button></div>
    {upload !== null && <progress max={100} value={upload} aria-label="Recepción del archivo" />}
    {message && <p className={`feedback ${uploadError ? "error" : "success"}`} role={uploadError ? "alert" : "status"}>{message}</p>}</div>
    <div className="import-history">{jobs.map((job, index) => {
      const summary = object(job.summary);
      return <details key={job.id} className="import-job" open={index === 0 || !["COMPLETED", "CANCELLED"].includes(job.status)}><summary className="import-job-heading"><div><h3>{job.originalName}</h3><p>{job.phase}</p></div><span className={`status ${job.status === "FAILED" ? "error" : job.status === "COMPLETED" ? "active" : job.status === "REVIEW" ? "warning" : job.status === "PROCESSING" ? "processing" : "inactive"}`}>{{ QUEUED: "En cola", PROCESSING: "Procesando", REVIEW: "Por revisar", COMPLETED: "Completado", FAILED: "Con errores", CANCELLED: "Cancelado" }[job.status]}</span><ChevronDown size={17} className="disclosure-caret" aria-hidden="true" /></summary><div className="import-job-body">
        {(job.total > 0 || job.processed > 0) && <p className="help">Revisados: {job.processed.toLocaleString("es-MX")} / {job.total.toLocaleString("es-MX")}</p>}
        {job.error && <p className="feedback error" role="alert">{job.error}</p>}
        {Object.keys(summary).length > 0 && <><dl className="import-summary">{[["total", "Filas leídas"], ["records", "Registros en nueva base"], ["emptyRows", "Filas vacías"], ["invalidRows", "Filas inválidas"], ["duplicateGroups", "Alfanuméricos duplicados"], ["missingImages", "Imágenes pendientes"], ["images", "Imágenes cargadas"], ["replaced", "Imágenes reemplazadas"], ["errorCount", "Errores de imagen"]].map(([key, label]) => summary[key] !== undefined ? <div key={key}><dt>{label}</dt><dd>{String(summary[key])}</dd></div> : null)}</dl><details><summary>Ver reporte de revisión</summary><pre>{JSON.stringify(summary, null, 2)}</pre><a className="auth-link" download={`reporte-${job.id}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(summary, null, 2))}`}>Descargar reporte</a></details></>}
        {job.kind === "CSV" && job.status === "REVIEW" && !job.canPublish && <MappingForm key={JSON.stringify(job.mapping)} job={job} submit={input => command(job, input)} />}
        {job.canPublish && <button className="button" onClick={async () => { if (await confirm("¿Publicar esta base? El modo reemplazar elimina de la nueva versión los registros ausentes. La validación quedará desactivada si estaba activa.")) void command(job, { action: "publish" }); }}>Publicar base revisada</button>}
        {(job.status === "FAILED" || job.status === "QUEUED") && <div className="row-actions"><button className="button button-secondary" onClick={() => command(job, { action: "retry" })}>Reintentar sin volver a subir</button>{job.kind === "IMAGES" && !job.replaceImages && <button className="button button-secondary" onClick={async () => { if (await confirm("¿Reintentar reemplazando las imágenes existentes de los mismos alfanuméricos?")) void command(job, { action: "retry", replaceImages: true }); }}>Reintentar reemplazando existentes</button>}</div>}
        {["QUEUED", "PROCESSING", "REVIEW"].includes(job.status) && <button className="button button-secondary" onClick={async () => { if (await confirm("¿Cancelar esta importación? La versión actual se conserva.")) void command(job, { action: "cancel" }); }}>Cancelar importación</button>}
      </div></details>;
    })}</div>
  </section>;
}

function MappingForm({ job, submit }: { job: Job; submit: (input: object) => Promise<void> }) {
  const headers = Array.isArray(job.headers) ? job.headers.filter((value): value is string => typeof value === "string") : [];
  const previous = object(job.mapping);
  const guess = (name: string) => String(previous[name] || headers.find(header => header.toLowerCase() === name || (name === "otro" && header.toLowerCase() === "tro")) || "");
  const [mapping, setMapping] = useState({ folio: guess("folio"), alfanum: guess("alfanum"), tipo: guess("tipo"), otro: guess("otro") });
  const [mode, setMode] = useState(job.mode);
  return <form className="stack mapping-form" onSubmit={event => { event.preventDefault(); void submit({ action: "configure", mode, mapping }); }}>
    <h3>Mapeo de columnas</h3>{(["folio", "alfanum", "tipo", "otro"] as const).map(name => <div className="field" key={name}><label htmlFor={`${job.id}-${name}`}>{name === "alfanum" ? "Alfanumérico de búsqueda" : name === "folio" ? "Folio que se mostrará" : name === "tipo" ? "Tipo de documento" : "Otros"}</label><select id={`${job.id}-${name}`} required={name === "folio" || name === "alfanum"} value={mapping[name]} onChange={event => setMapping({ ...mapping, [name]: event.target.value })}><option value="">{name === "folio" || name === "alfanum" ? "Selecciona una columna" : "Sin mapear"}</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></div>)}
    <div className="field"><label htmlFor={`${job.id}-mode`}>Cómo actualizar la base</label><select id={`${job.id}-mode`} value={mode} onChange={event => setMode(event.target.value)}><option value="REPLACE">Reemplazar base completa</option><option value="UPSERT">Agregar y actualizar por alfanumérico</option></select></div>
    <button className="button">Analizar archivo completo</button>
  </form>;
}
