"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, ExternalLink } from "lucide-react";
import { HelpPopover } from "@/components/ui/help-popover";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const subscribe = (listener: () => void) => { const media = window.matchMedia("(display-mode: standalone)"); media.addEventListener("change", listener); window.addEventListener("appinstalled", listener); return () => { media.removeEventListener("change", listener); window.removeEventListener("appinstalled", listener); }; };
export function PublicInstall() {
  const installed = useSyncExternalStore(subscribe, standalone, () => false);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", capture);
    if ("serviceWorker" in navigator && window.isSecureContext) void navigator.serviceWorker.register("/public-validation-sw.js", { scope: "/v/", updateViaCache: "none" }).catch(() => {});
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);
  if (installed) return null;
  return <section className="public-install" aria-label="Instalar consulta"><div><Download size={17} aria-hidden="true" /><span>Esta consulta, a un toque.</span></div><div className="public-install-actions">{prompt ? <button className="button button-secondary" disabled={pending} onClick={async () => {
    setPending(true); setMessage("");
    try { await prompt.prompt(); const choice = await prompt.userChoice; setPrompt(null); if (choice.outcome === "accepted") setMessage("Instalación solicitada al navegador."); }
    catch { setMessage("Usa la opción Instalar aplicación del menú de tu navegador."); }
    finally { setPending(false); }
  }}>{pending ? "Abriendo…" : "Instalar consulta"}<Download size={15} aria-hidden="true" /></button> : <span className="help">Añádela a tu pantalla de inicio</span>}<HelpPopover label="Cómo instalar esta consulta"><p>En Android o escritorio, abre el menú del navegador y elige <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</p><p>En iPhone o iPad, abre Compartir y elige <strong>Añadir a pantalla de inicio</strong>.</p><p>La instalación depende del navegador. Siempre necesitas conexión para consultar documentos.</p><ExternalLink size={16} aria-hidden="true" /></HelpPopover></div>{message && <p className="help" role="status">{message}</p>}</section>;
}
