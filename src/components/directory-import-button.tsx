"use client";

import { useState } from "react";

export function DirectoryImportButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  async function start() {
    setBusy(true); setMessage(""); setError(false);
    try {
      const response = await fetch(`/api/validations/${id}/image-sync`, { method: "POST" });
      const result = await response.json();
      setError(!response.ok); setMessage(response.ok ? "Análisis iniciado. Puedes consultar su avance en el historial de imágenes." : result.message || "No se pudo iniciar el análisis.");
      if (response.ok) window.dispatchEvent(new CustomEvent("valweb-import-started", { detail: { validationId: id } }));
    } catch { setError(true); setMessage("No se pudo conectar. La carpeta no se modificó."); }
    finally { setBusy(false); }
  }
  return <div><button className="button" type="button" disabled={busy} onClick={start}>{busy ? "Iniciando…" : "Procesar"}</button>{message && <p className={`feedback ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{message}</p>}</div>;
}
