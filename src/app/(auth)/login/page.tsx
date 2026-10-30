import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  const actor = await getActor();
  if (actor && actor.role !== "CONSULTATION_ONLY") redirect("/dashboard");
  return <section className="auth-content"><div className="auth-intro"><h1>Accede a tu espacio</h1><p>Gestiona tus cuentas y el acceso de tu equipo.</p></div><LoginForm /><Link className="auth-link" href="/recuperar-acceso">¿Olvidaste tu contraseña?</Link></section>;
}
