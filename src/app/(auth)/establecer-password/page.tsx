import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { setPasswordAction } from "@/app/actions";
import { getAccessTokenInfo } from "@/features/identity/service";

export const metadata = { title: "Establecer contraseña" };

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const info = token ? await getAccessTokenInfo(token) : null;
  if (!info) return <section className="auth-content"><div className="auth-intro"><h1>Este enlace ya no está disponible</h1><p>Puede haber caducado o haberse utilizado. Si era una invitación, contacta a tu administrador.</p></div><Link className="button" href="/recuperar-acceso">Recuperar acceso</Link><Link className="auth-link" href="/login">Volver a iniciar sesión</Link></section>;
  return <section className="auth-content"><div className="auth-intro"><h1>{info.purpose === "INVITE" ? "Activa tu acceso" : "Elige una nueva contraseña"}</h1><p>Establece la contraseña de <strong>{info.email}</strong>.</p></div><ActionForm action={setPasswordAction} label="Guardar contraseña" resetOnSuccess><input type="hidden" name="token" value={token} /><div className="field"><label htmlFor="password">Nueva contraseña</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required aria-describedby="password-help" /><p className="help" id="password-help">Entre 12 y 128 caracteres. Puedes usar una frase larga.</p></div><div className="field"><label htmlFor="confirmPassword">Confirmar contraseña</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></div></ActionForm><Link className="auth-link" href="/login">Ir a iniciar sesión</Link></section>;
}
