import { ActionForm } from "@/components/action-form";
import { saveGlobalImageLocationAction } from "@/features/images/actions";
import type { getGlobalImageLocations } from "@/features/images/locations";

export function ImageStorageSettings({ locations }: { locations: Awaited<ReturnType<typeof getGlobalImageLocations>> }) {
  return <section id="image-storage" className="form-section system-image-storage" aria-labelledby="image-storage-settings-title">
    <div><h2 id="image-storage-settings-title">Almacenamiento de imágenes</h2><p>Configura las rutas globales. Cada validación elige su destino desde Imágenes y utiliza su propia carpeta.</p><p>Las carpetas raíz deben existir y permitir lectura y escritura. Para NFS, indica la ruta del montaje en este servidor.</p></div>
    <div className="image-location-fields">{locations.map(location => {
      const label = location.kind === "LOCAL" ? "local" : "NFS", inputId = `storage-root-${location.kind}`;
      return <div key={location.kind} className="storage-location"><div className="section-line"><h3>{location.kind === "LOCAL" ? "Local" : "NFS"}</h3><span className={`status ${location.available ? "active" : "inactive"}`}>{!location.configured ? "Sin configurar" : location.available ? "Disponible" : "No disponible"}</span></div>
        <ActionForm action={saveGlobalImageLocationAction} label={`Guardar destino ${label}`} pendingLabel="Verificando acceso…">
          <input type="hidden" name="kind" value={location.kind} />
          <div className="field"><label htmlFor={inputId}>Ruta {label}</label><input id={inputId} name="rootPath" defaultValue={location.rootPath} required maxLength={4096} placeholder={location.kind === "NFS" ? "/mnt/valweb-nfs" : "/var/lib/valweb/images-local"} autoComplete="off" spellCheck={false} /></div>
        </ActionForm>
      </div>;
    })}</div>
    <p className="help storage-root-note">Una ruta en uso se conserva; guardar otra no traslada sus archivos.</p>
  </section>;
}
