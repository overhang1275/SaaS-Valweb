import type { Metadata, Viewport } from "next";
import { PublicInstall } from "@/components/public-install";
import { notFound } from "next/navigation";
import { getPublicValidation } from "@/features/public/service";
import { Brand } from "@/components/brand";
import { AuthStory } from "@/components/auth-story";
import { PublicValidation } from "@/components/public-validation";
import { PublicAccessForm } from "@/components/public-access-form";
import { cookies } from "next/headers";
import { PUBLIC_ACCESS_COOKIE, hasPublicValidationAccess } from "@/features/public/access";

export const viewport: Viewport = { themeColor: "#002a45", colorScheme: "light" };
export async function generateMetadata({ params }: { params: Promise<{ publicToken: string }> }): Promise<Metadata> {
  const { publicToken } = await params; const validation = await getPublicValidation(publicToken);
  if (!validation) return { title: "Validación no disponible" };
  const title = validation.requireClientAccess ? "Acceso a la consulta" : validation.title;
  return { title, applicationName: "Valweb · Computer Forms", manifest: `/v/${publicToken}/manifest.webmanifest`, appleWebApp: { capable: true, title: Array.from(title).slice(0, 12).join(""), statusBarStyle: "default" }, icons: { apple: [{ url: "/pwa/icon-180.png", sizes: "180x180", type: "image/png" }] } };
}

export default async function PublicValidationPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  const validation = await getPublicValidation(publicToken);
  if (!validation) notFound();
  const allowed = !validation.requireClientAccess || await hasPublicValidationAccess(validation.id, (await cookies()).get(PUBLIC_ACCESS_COOKIE)?.value);
  return <div className="auth-shell public-shell"><header className="auth-header"><Brand /><a className="company-link" href="https://computerforms.com.mx/" target="_blank" rel="noopener noreferrer">Computer Forms</a></header><div className="auth-grid"><AuthStory publicPage /><main id="main-content" className="auth-main"><div className="public-auth-content">{allowed ? <PublicValidation token={publicToken} title={validation.title} instructions={validation.instructions} /> : <PublicAccessForm token={publicToken} />}{allowed && <PublicInstall />}</div></main></div><footer className="auth-footer"><span>Valweb · Computer Forms</span><span>Consulta documental de acceso compartido</span></footer></div>;
}
