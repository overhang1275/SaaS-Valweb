import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { getSystemStatus } from "@/features/system/service";
import { restartImportWorkerAction } from "@/features/system/actions";
import { ActionForm } from "@/components/action-form";
import { SystemRefresh } from "@/components/system-refresh";

export const metadata = { title: "Ajustes generales" };
export const runtime = "nodejs";

const workerLabels = { running: "En ejecución", restarting: "Reiniciando", stopped: "Detenido", unconfigured: "Sin configurar", unavailable: "No disponible" };
export default async function SettingsPage() {
  const status = await getSystemStatus(await requireActor(true));
  const controllable = status.worker === "running" || status.worker === "stopped";
  const needsAttention = status.worker !== "running" || status.database === null || status.freeGiB === null || status.freeGiB < 1;
  return <div className="system-settings">
    <div className="page-heading"><div><h1>Ajustes generales</h1><p>Estado de Valweb y recuperación de las cargas de datos.</p></div><SystemRefresh /></div>
    <section className="system-health" aria-labelledby="system-health-title">
      <div className="section-line"><h2 id="system-health-title">Estado del sistema</h2><span className={`status ${needsAttention ? "inactive" : "active"}`}>{needsAttention ? "Requiere atención" : "Servicios disponibles"}</span></div>
      <p className="help">Última comprobación: <time dateTime={status.checkedAt}>{new Date(status.checkedAt).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}</time> · Se actualiza cada 10 segundos.</p>
      <dl className="system-services">
        <div><dt>Base de datos</dt><dd><strong>{status.database === null ? "No disponible" : "Conectada"}</strong><span>{status.database === null ? "No se pudo comprobar la conexión." : `Respuesta de la consulta: ${status.database} ms`}</span></dd></div>
        <div><dt>Procesador de importaciones</dt><dd><strong>{workerLabels[status.worker]}</strong><span>{status.worker === "running" ? "Recibe y procesa los lotes de CSV e imágenes." : status.worker === "restarting" ? "El servicio está iniciándose o esperando a terminar el lote activo." : status.worker === "stopped" ? "Las cargas permanecerán en cola hasta iniciarlo." : "Solicita configurar el servicio del procesador en el servidor."}</span></dd></div>
        <div><dt>Espacio para cargas</dt><dd><strong>{status.freeGiB === null ? "No disponible" : `${status.freeGiB.toLocaleString("es-MX")} GiB libres`}</strong><span>{status.freeGiB === null ? "No se pudo comprobar el almacenamiento." : status.freeGiB < 1 ? "Espacio insuficiente para recibir nuevas cargas." : "Espacio disponible en el volumen de importaciones."}</span></dd></div>
      </dl>
    </section>
    <section className="system-imports" aria-labelledby="system-imports-title"><div className="section-line"><h2 id="system-imports-title">Cargas de datos</h2><Link className="text-link" href="/validaciones">Ver validaciones</Link></div>
      <dl className="system-job-counts">{([["En cola", status.queued], ["En proceso", status.processing], ["Por revisar", status.review], ["Con errores", status.failed]] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count === null ? "—" : count.toLocaleString("es-MX")}</dd></div>)}</dl>
      <p className="help">Los lotes por revisar necesitan el mapeo de columnas. Revisa los errores desde la validación correspondiente; reiniciar no corrige archivos inválidos.</p>
    </section>
    <section className="form-section system-recovery" aria-labelledby="system-recovery-title"><div><h2 id="system-recovery-title">Recuperar el procesador</h2><p>Inicia el servicio si está detenido o reinícialo si necesitas recuperar el procesamiento.</p><p>Un lote activo termina antes del reinicio. Las cargas en cola se conservan; no hace falta volver a subirlas.</p></div>
      <ActionForm action={restartImportWorkerAction} label={status.worker === "stopped" ? "Iniciar procesador" : "Reiniciar procesador"} pendingLabel="Solicitando…" disabled={!controllable} confirmMessage="¿Reiniciar el procesador de importaciones? Si hay un lote activo, terminará antes del reinicio. Las cargas en cola se conservan."><p className="help">Esta acción afecta a las cargas de todas las cuentas. El acceso y las consultas públicas siguen disponibles.</p></ActionForm>
    </section>
  </div>;
}
