import { ArrowUpRight, Clock3 } from "lucide-react";
import { Brand } from "@/components/brand";
import { AuthStory } from "@/components/auth-story";

export function PublicValidationPending() {
  return <div className="auth-shell public-shell">
    <header className="auth-header"><Brand /><a className="company-link" href="https://computerforms.com.mx/" target="_blank" rel="noopener noreferrer">Computer Forms</a></header>
    <div className="auth-grid">
      <AuthStory publicPage />
      <main id="main-content" className="auth-main">
        <section className="public-pending" aria-labelledby="public-pending-title">
          <span className="public-pending-icon"><Clock3 size={25} strokeWidth={1.8} aria-hidden="true" /></span>
          <p className="public-pending-label">Consulta documental</p>
          <h1 id="public-pending-title">Estamos preparando tu consulta</h1>
          <p className="public-pending-copy">La validación que buscas aún no está habilitada. Cuando el equipo que te compartió este enlace la active, podrás consultar aquí la información de tus documentos.</p>
          <p className="public-pending-help">¿Esperabas que ya estuviera disponible? Confirma con la persona que te compartió el enlace.</p>
          <a className="button public-pending-link" href="https://computerforms.com.mx/" target="_blank" rel="noopener noreferrer">Conoce Computer Forms <ArrowUpRight size={16} aria-hidden="true" /></a>
        </section>
      </main>
    </div>
    <footer className="auth-footer"><span>Valweb · Computer Forms</span><span>Consulta documental de acceso compartido</span></footer>
  </div>;
}
