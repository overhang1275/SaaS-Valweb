import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { createValidationImageFolderAction, selectValidationImageStorageAction } from "@/features/images/actions";
import type { ValidationImageStorage } from "@/features/images/locations";
import { DirectoryImportButton } from "@/components/directory-import-button";

export function ValidationImageStorageSettings({ id, storage, admin }: { id: string; storage: ValidationImageStorage; admin: boolean }) {
  const current = storage.kind === "LOCAL" ? "Local" : storage.kind === "NFS" ? "NFS" : "Almacenamiento existente";
  const available = storage.options.some(option => option.available);
  const selectedAvailable = storage.options.find(option => option.kind === storage.kind)?.available;
  return <section className="surface image-storage-panel" aria-labelledby="validation-storage-title">
    <div className="section-line"><h2 id="validation-storage-title">Almacenamiento</h2><span className={`status ${storage.kind && !selectedAvailable ? "inactive" : "active"}`}>{current}</span></div>
    {storage.lockedReason ? <p className="help storage-lock-reason">{storage.lockedReason}</p> : <ActionForm action={selectValidationImageStorageAction} label="Guardar destino" disabled={!available}>
      <input type="hidden" name="id" value={id} />
      <div className="field"><label htmlFor="validation-storage-kind">Destino de las imágenes</label><select id="validation-storage-kind" name="kind" defaultValue={storage.kind ?? (storage.options.find(option => option.kind === "LOCAL")?.available ? "LOCAL" : "")} required disabled={!available}>
        <option value="" disabled>Selecciona un destino</option>
        {storage.options.map(option => <option key={option.kind} value={option.kind} disabled={!option.available}>{option.kind === "LOCAL" ? "Local" : "NFS"}{!option.configured ? " (sin configurar)" : !option.available ? " (no disponible)" : ""}</option>)}
      </select></div>
    </ActionForm>}
    {!available && <p className="help">No hay destinos disponibles. Solicita al administrador comprobar las rutas y sus permisos.</p>}
    {admin && <Link className="text-link storage-settings-link" href="/admin/ajustes#image-storage">Configurar destinos globales</Link>}
    {storage.kind && <div className="storage-folder"><div className="section-line"><h3>Carpeta de la validación</h3><span className={`status ${storage.folderState === "ready" ? "active" : "inactive"}`} role="status">{storage.folderState === "ready" ? "Lista" : storage.folderState === "missing" ? "Por preparar" : "No disponible"}</span></div>
      <p className="storage-path"><code>{storage.fullPath ?? storage.folderName}</code></p>
      <ActionForm key={storage.kind} action={createValidationImageFolderAction} label={storage.folderState === "ready" ? "Carpeta preparada" : "Crear carpeta"} pendingLabel="Preparando carpeta…" disabled={!selectedAvailable || storage.folderState === "ready"}>
        <input type="hidden" name="id" value={id} />
        <p className="help">Prepara <code>por_procesar/</code> para recibir originales y <code>procesadas/</code> para las imágenes del catálogo. No importa ni modifica archivos.</p>
      </ActionForm>
      {storage.folderState === "ready" && <div className="storage-inbox" aria-labelledby="storage-inbox-title">
        <div className="section-line"><h3 id="storage-inbox-title">Recepción FTP</h3><span className="status">{storage.pendingImages.toLocaleString("es-MX")} imágenes</span></div>
        <p className="help">Deposita los originales en <code>por_procesar/</code> y renómbralos al terminar de subirlos.</p>
        {storage.pendingImages > 0 && <><DirectoryImportButton id={id} /><p className="help">Se revisan los archivos completos de <code>por_procesar/</code>. Los originales solo se borran después de publicar; los errores y reemplazos sin confirmar permanecen.</p></>}
      </div>}
    </div>}
  </section>;
}
