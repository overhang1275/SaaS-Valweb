"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await signIn("credentials", { email: form.get("email"), password: form.get("password"), redirect: false });
      if (result?.ok) { router.push("/dashboard"); router.refresh(); return; }
      setMessage("No pudimos iniciar sesión. Revisa tus datos y el estado de tu acceso; si has hecho varios intentos, espera 15 minutos.");
    } catch { setMessage("No se pudo conectar. Inténtalo de nuevo."); }
    setPending(false);
  }
  return <form onSubmit={submit} className="stack" aria-describedby={message ? "login-error" : undefined}>
    <div className="field"><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="username" placeholder="tu@empresa.com" required maxLength={254} /></div>
    <div className="field"><label htmlFor="password">Contraseña</label><div className="password-control"><input id="password" name="password" type={visible ? "text" : "password"} autoComplete="current-password" required maxLength={128} /><button type="button" className="password-toggle" onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={visible}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
    <button className="button" type="submit" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    <div id="login-error" role="alert" aria-live="polite">{message && <p className="feedback error">{message}</p>}</div>
  </form>;
}
