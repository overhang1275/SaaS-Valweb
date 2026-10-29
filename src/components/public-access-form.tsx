"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export function PublicAccessForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/public/validations/${token}/access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const result = await response.json() as { message?: string };
      if (!response.ok) { setMessage(result.message || "No se pudo iniciar sesión."); return; }
      window.location.reload();
    } catch { setMessage("No se pudo conectar. Inténtalo de nuevo."); }
    finally { setPending(false); }
  }
  return <section className="public-validation public-access auth-content" aria-labelledby="public-access-title">
    <header className="public-page-heading auth-intro"><h1 id="public-access-title">Acceso a la consulta</h1><p className="public-instructions">Inicia sesión con el correo y la contraseña de tu cuenta de cliente.</p></header>
    <form className="stack" aria-busy={pending} onSubmit={submit}>
      <div className="field"><label htmlFor="public-access-email">Correo electrónico</label><input id="public-access-email" name="email" type="email" autoComplete="username" required maxLength={254} /></div>
      <div className="field"><label htmlFor="public-access-password">Contraseña</label><input id="public-access-password" name="password" type="password" autoComplete="current-password" required maxLength={128} /></div>
      <button className="button" type="submit" disabled={pending}>{pending ? "Verificando…" : "Entrar"}</button>
      {message && <p className="feedback error" role="alert">{message}</p>}
    </form>
    <Link className="auth-link" href="/recuperar-acceso">¿Olvidaste tu contraseña?</Link>
  </section>;
}
