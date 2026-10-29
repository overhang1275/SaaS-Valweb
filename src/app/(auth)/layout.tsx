import { Brand } from "@/components/brand";
import { AuthStory } from "@/components/auth-story";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell"><header className="auth-header"><Brand /><a className="company-link" href="https://computerforms.com.mx/" target="_blank" rel="noopener noreferrer">Computer Forms</a></header><div className="auth-grid"><AuthStory /><main id="main-content" className="auth-main">{children}</main></div><footer className="auth-footer"><span>Valweb · Computer Forms</span><span>¿Necesitas una cuenta? Contacta a tu administrador.</span></footer></div>;
}
