import type { Metadata, Viewport } from "next";
import { PublicInstall } from "@/components/public-install";
import { notFound } from "next/navigation";
import { getPublicValidation } from "@/features/public/service";
import Image from "next/image";
import { Brand } from "@/components/brand";
import { PublicValidation } from "@/components/public-validation";

export const viewport: Viewport = { themeColor: "#002a45", colorScheme: "light" };
export async function generateMetadata({ params }: { params: Promise<{ publicToken: string }> }): Promise<Metadata> {
  const { publicToken } = await params; const validation = await getPublicValidation(publicToken);
  if (!validation) return { title: "Validación no disponible" };
  return { title: validation.title, applicationName: "Valweb · Computer Forms", manifest: `/v/${publicToken}/manifest.webmanifest`, appleWebApp: { capable: true, title: Array.from(validation.title).slice(0, 12).join(""), statusBarStyle: "default" }, icons: { apple: [{ url: "/pwa/icon-180.png", sizes: "180x180", type: "image/png" }] } };
}

export default async function PublicValidationPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  const validation = await getPublicValidation(publicToken);
  if (!validation) notFound();
  return <div className="public-shell"><header className="public-header"><Brand /><a href="https://computerforms.com.mx/" target="_blank" rel="noopener noreferrer"><Image src="/brand/computerforms.svg" width={180} height={25} alt="Computer Forms" unoptimized /></a></header><PublicInstall /><main id="main-content"><PublicValidation token={publicToken} title={validation.title} instructions={validation.instructions} /></main><footer className="public-footer">Valweb · Una plataforma de Computer Forms</footer></div>;
}
