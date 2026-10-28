"use client";

import { useId, useState } from "react";
import { Copy, Check } from "lucide-react";

export function ValidationLink({ url, name }: { url: string; name: string }) {
  const id = useId();
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setMessage("Enlace copiado.");
    } catch {
      setCopied(false);
      setMessage("Selecciona el enlace y cópialo manualmente.");
    }
  }
  return <div className="validation-link">
    <label htmlFor={id} className="sr-only">Enlace público de {name}</label>
    <div className="link-control">
      <input id={id} type="text" readOnly value={url} onFocus={event => event.currentTarget.select()} />
      <button className="button button-secondary" type="button" onClick={copy} aria-label={`Copiar enlace de ${name}`}>
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}Copiar
      </button>
    </div>
    <p role="status" aria-live="polite" className="help">{message}</p>
  </div>;
}
