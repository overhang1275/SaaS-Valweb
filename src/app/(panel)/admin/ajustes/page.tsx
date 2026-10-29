import Link from "next/link";
import { requireActor } from "@/lib/auth";
import { getSystemStatus } from "@/features/system/service";
import { restartImportWorkerAction, sendConfiguredTestEmailAction } from "@/features/system/actions";
import { ActionForm } from "@/components/action-form";
import { SystemRefresh } from "@/components/system-refresh";
import { ImageStorageSettings } from "@/components/image-storage-settings";
import { getGlobalImageLocations } from "@/features/images/locations";

export const metadata = { title: "Ajustes generales" };
export const runtime = "nodejs";

const workerLabels = { running: "En ejecución", restarting: "Reiniciando", stopped: "Detenido", unconfigured: "Sin configurar", unavailable: "No disponible" };
const settingsSections = ["sistema", "almacenamiento", "notificaciones", "operacion"] as const;
type SettingsSection = typeof settingsSections[number];
const settingsLabels: Record<SettingsSection, string> = { sistema: "Sistema", almacenamiento: "Almacenamiento", notificaciones: "Notificaciones", operacion: "Operación" };
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ seccion?: string }> }) {
  const params = await searchParams;
  const selected: SettingsSection = settingsSections.includes(params.seccion as SettingsSection) ? params.seccion as SettingsSection : "sistema";
  const actor = await requireActor(true);
  const [status, locations] = await Promise.all([getSystemStatus(actor), getGlobalImageLocations(actor)]);
  const controllable = status.worker === "running" || status.worker === "stopped";
  const needsAttention = status.worker !== "running" || status.database === null || status.freeGiB === null || status.freeGiB < 1;
  return <div className="system-settings">
    <div className="page-heading"><div><h1>Ajustes generales</h1><p>Estado de Valweb y recuperación de las cargas de datos.</p></div><SystemRefresh /></div>
    <nav className="settings-nav" aria-label="Secciones de ajustes">{settingsSections.map(section => <Link key={section} href={`/admin/ajustes?seccion=${section}`} aria-current={selected === section ? "page" : undefined}>{settingsLabels[section]}</Link>)}</nav>
    {selected === "sistema" && <><section className="system-health" aria-labelledby="system-health-title">
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
    </section></>}
    {selected === "almacenamiento" && <ImageStorageSettings locations={locations} />}
    {selected === "notificaciones" && <section className="form-section system-mail-test" aria-labelledby="system-mail-test-title">
      <div><h2 id="system-mail-test-title">Correo electrónico</h2><p>Envía una prueba al buzón configurado en SMTP para comprobar que Valweb puede entregar mensajes.</p></div>
      <ActionForm action={sendConfiguredTestEmailAction} label="Enviar correo de prueba" pendingLabel="Enviando…"><p className="help">La prueba se envía a SMTP_USER o, si no está definido, a SMTP_FROM. Se limita a un envío por minuto.</p></ActionForm>
    </section>}
    {selected === "operacion" && <section className="form-section system-recovery" aria-labelledby="system-recovery-title"><div><h2 id="system-recovery-title">Recuperar el procesador</h2><p>Inicia el servicio si está detenido o reinícialo si necesitas recuperar el procesamiento.</p><p>Un lote activo termina antes del reinicio. Las cargas en cola se conservan; no hace falta volver a subirlas.</p></div>
      <ActionForm action={restartImportWorkerAction} label={status.worker === "stopped" ? "Iniciar procesador" : "Reiniciar procesador"} pendingLabel="Solicitando…" disabled={!controllable} confirmMessage="¿Reiniciar el procesador de importaciones? Si hay un lote activo, terminará antes del reinicio. Las cargas en cola se conservan."><p className="help">Esta acción afecta a las cargas de todas las cuentas. El acceso y las consultas públicas siguen disponibles.</p></ActionForm>
    </section>}
  </div>;
}
