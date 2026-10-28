"use client";
import { useConfirm } from "@/components/ui/confirmation";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RecordImageDelete({ validationId, imageId, name, active, disabled = false, onDeleted }: { validationId: string; imageId: string; name: string; active: boolean; disabled?: boolean; onDeleted?: () => void }) {
  const confirm = useConfirm();
  const router = useRouter(); const [pending, setPending] = useState(false); const [message, setMessage] = useState("");
  return <div><button className="button button-secondary danger-button" disabled={pending || disabled} onClick={async () => {
    if (!await confirm(`¿Eliminar ${name}?${active ? " La validación quedará desactivada." : ""}`)) return;
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/validations/${validationId}/images/${imageId}`, { method: "DELETE", headers: { "X-Confirm-Deactivation": active ? "true" : "false" } });
      const result = await response.json(); setMessage(result.message || "No se pudo eliminar la imagen."); if (response.ok) onDeleted?.(); router.refresh();
    } catch { setMessage("No se pudo completar la conexión. Revisa el estado antes de reintentar."); }
    finally { setPending(false); }
  }}>{pending ? "Eliminando…" : "Eliminar"}</button><p className="help" role="status">{message}</p></div>;
}
