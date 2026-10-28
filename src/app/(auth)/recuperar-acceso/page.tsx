import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { resetPasswordAction } from "@/app/actions";

export const metadata = { title: "Recuperar acceso" };

export default function RecoveryPage() {
  return <section className="auth-content"><div className="auth-intro"><h1>Recupera tu acceso</h1><p>Te enviaremos un enlace para establecer una nueva contraseña.</p></div><ActionForm action={resetPasswordAction} label="Enviar enlace" pendingLabel="Enviando…" resetOnSuccess><div className="field"><label htmlFor="email">Correo electrónico</label><input id="email" name="email" type="email" autoComplete="email" maxLength={254} required placeholder="tu@empresa.com" /></div></ActionForm><Link className="auth-link" href="/login">Volver a iniciar sesión</Link></section>;
}
