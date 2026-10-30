import { ActionForm } from "@/components/action-form";
import { repairConfiguredNfsImageFoldersAction, saveGlobalImageLocationAction } from "@/features/images/actions";
import type { getGlobalImageLocations } from "@/features/images/locations";

export function ImageStorageSettings({ locations }: { locations: Awaited<ReturnType<typeof getGlobalImageLocations>> }) {
  return <section id="image-storage" className="form-section system-image-storage" aria-labelledby="image-storage-settings-title">
    <div><h2 id="image-storage-settings-title">Almacenamiento de imágenes</h2><p>Configura las rutas globales. Cada validación elige su destino desde Imágenes y utiliza su propia carpeta.</p><p>Las carpetas raíz deben existir y permitir lectura y escritura. Para NFS, indica la ruta del montaje en este servidor.</p></div>
    <div className="image-location-fields">{locations.map(location => {
      const label = location.kind === "LOCAL" ? "local" : "NFS", inputId = `storage-root-${location.kind}`;
      return <div key={location.kind} className="storage-location"><div className="section-line"><h3>{location.kind === "LOCAL" ? "Local" : "NFS"}</h3><span className={`status ${location.available ? "active" : "inactive"}`}>{!location.configured ? "Sin configurar" : location.available ? "Disponible" : location.mode ? "Permisos incompletos" : "No disponible"}</span></div>
        <ActionForm action={saveGlobalImageLocationAction} label={`Guardar destino ${label}`} pendingLabel="Verificando acceso…">
          <input type="hidden" name="kind" value={location.kind} />
          <div className="field"><label htmlFor={inputId}>Ruta {label}</label><input id={inputId} name="rootPath" defaultValue={location.rootPath} required maxLength={4096} placeholder={location.kind === "NFS" ? "/mnt/valweb-nfs" : "/var/lib/valweb/images-local"} autoComplete="off" spellCheck={false} /></div>
        </ActionForm>
        {location.kind === "NFS" && location.configured && <>
          <dl className="storage-permissions"><div><dt>Propietario UID</dt><dd>{location.ownerUid ?? "—"}</dd></div><div><dt>Grupo GID</dt><dd>{location.groupGid ?? "—"}</dd></div><div><dt>Modo Unix</dt><dd>{location.mode ? `0o${location.mode}` : "—"}</dd></div><div><dt>Acceso de Valweb</dt><dd>{location.available ? "Lectura y escritura" : "Insuficiente"}</dd></div></dl>
          <ActionForm action={repairConfiguredNfsImageFoldersAction} label="Reparar permisos de carpetas existentes" pendingLabel="Reparando permisos…" disabled={!location.canRepairPermissions} confirmMessage="Se ajustará el grupo y los permisos solo de las carpetas NFS de validación y por_procesar/. No se modificarán imágenes ni la configuración ACL de la NAS.">
            <p className="help">Repara el GID y el acceso de grupo en las carpetas de validaciones existentes. La raíz NFS debe usar el mismo GID que `valweb-images` y Valweb debe tener lectura y escritura en el montaje. No cambia ACL de la NAS ni permisos de los archivos.</p>
          </ActionForm>
        </>}
      </div>;
    })}</div>
    <p className="help storage-root-note">Una ruta en uso se conserva; guardar otra no traslada sus archivos.</p>
  </section>;
}
