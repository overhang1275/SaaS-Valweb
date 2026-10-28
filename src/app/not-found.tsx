import Link from "next/link";

export default function NotFound() {
  return <main id="main-content" className="standalone-error"><h1>Página no encontrada</h1><p>Revisa el enlace o vuelve a tu espacio de trabajo.</p><Link className="button" href="/dashboard">Ir al resumen</Link></main>;
}
