import type { Metadata } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "./globals.css";
import { MotionProvider } from "@/components/ui/motion";
import { ConfirmationProvider } from "@/components/ui/confirmation";

export const metadata: Metadata = { title: { default: "Valweb", template: "%s · Valweb" }, description: "Valweb, plataforma de validación documental de Computer Forms.", robots: { index: false, follow: false } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><a className="skip-link" href="#main-content">Saltar al contenido</a><MotionProvider><ConfirmationProvider>{children}</ConfirmationProvider></MotionProvider></body></html>;
}
