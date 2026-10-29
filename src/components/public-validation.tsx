"use client";

import { DocumentViewer } from "@/components/ui/document-viewer";
import { CheckCircle2, CircleAlert, RotateCw } from "lucide-react";
import { ResultSkeleton } from "@/components/ui/skeleton";
import { useEffect, useRef, useState } from "react";
import type { verifyAlfanum } from "@/features/public/service";
import { useHydrated } from "@/lib/use-hydrated";

type Result = NonNullable<Awaited<ReturnType<typeof verifyAlfanum>>>;
export function PublicValidation({ token, title, instructions }: { token: string; title: string; instructions: string }) {
  const [alfanum, setAlfanum] = useState("");
  const ready = useHydrated();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const output = useRef<HTMLElement>(null);
  useEffect(() => { if (result) output.current?.focus(); }, [result]);
  return <section className="public-validation auth-content" aria-labelledby="public-validation-title">
    <header className="public-page-heading auth-intro"><h1 id="public-validation-title">{title}</h1><p className="public-instructions">{instructions}</p></header>
    <form ref={form} className="stack public-query-form" aria-busy={pending} onSubmit={async event => {
      event.preventDefault(); setPending(true); setResult(null); setMessage("");
      try {
        const response = await fetch(`/api/public/validations/${token}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alfanum }) });
        const data = await response.json();
        if (response.ok) setResult(data as Result); else setMessage(data.message || "No se pudo completar la consulta.");
      } catch { setMessage("No se pudo conectar con el servicio. Inténtalo de nuevo."); }
      finally { setPending(false); }
    }}>
      <div className="field"><label htmlFor="public-alfanum">Código alfanumérico</label><input id="public-alfanum" name="alfanum" autoComplete="off" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9]+" required maxLength={128} disabled={pending || !ready} value={alfanum} onChange={event => { setAlfanum(event.target.value); setResult(null); setMessage(""); }} placeholder="Ej. 4frs5…" aria-describedby="public-code-help" /><p className="help" id="public-code-help">El folio aparece en el resultado; busca con el código alfanumérico.</p></div>
      <button className="button" disabled={pending || !ready}>{pending ? "Buscando…" : "Consultar"}</button>
      {message && <div className="feedback error" role="alert"><p>{message}</p><button type="button" className="text-link retry-button" onClick={() => form.current?.requestSubmit()}>Intentar de nuevo<RotateCw size={15} aria-hidden="true" /></button></div>}
    </form>
    {pending && <ResultSkeleton />}
    {result && <section ref={output} tabIndex={-1} className="public-result" aria-label="Resultado de la consulta"><p className={`feedback result-feedback ${result.found ? "success" : "error"}`} role="status">{result.found ? <CheckCircle2 size={20} aria-hidden="true" /> : <CircleAlert size={20} aria-hidden="true" />}{result.message}</p>{result.found && <>
      {result.fields.length > 0 && <dl className="public-record-fields">{result.fields.map(field => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
      {result.image && <DocumentViewer key={result.image.grant} grant={result.image.grant} alt={result.image.alt} onRetry={() => form.current?.requestSubmit()} />}
      {result.imageUnavailable && <p className="help" role="status">El registro existe, pero su imagen no está disponible. Contacta a quien te compartió el enlace.</p>}
    </>}</section>}
  </section>;
}
