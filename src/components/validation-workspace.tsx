"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutDashboard, Files, Images, SlidersHorizontal, Settings2 } from "lucide-react";
import { useTransition, type ReactNode } from "react";

const sections = [{ value: "resumen", label: "Resumen", Icon: LayoutDashboard }, { value: "datos", label: "Registros", Icon: Files }, { value: "imagenes", label: "Imágenes", Icon: Images }, { value: "apariencia", label: "Apariencia", Icon: SlidersHorizontal }, { value: "ajustes", label: "Ajustes", Icon: Settings2 }];
export function ValidationWorkspace({ metrics, inspector, overview, data, images, appearance, settings }: { metrics: ReactNode; inspector: ReactNode; overview: ReactNode; data: ReactNode; images: ReactNode; appearance: ReactNode; settings: ReactNode }) {
  const search = useSearchParams(); const requested = search.get("tab"); const selected = sections.some(section => section.value === requested) ? requested! : "resumen";
  return <Tabs.Root value={selected} onValueChange={value => { const url = new URL(window.location.href); if ((url.searchParams.get("tab") || "resumen") === value) return; url.searchParams.set("tab", value); url.searchParams.delete("creada"); url.hash = ""; window.history.pushState(null, "", url); }} className="validation-workspace" data-section={selected}>
    <Tabs.List className="workspace-tabs" aria-label="Secciones de la validación">{sections.map(({ value, label, Icon }) => <Tabs.Trigger className="workspace-tab" value={value} key={value}><Icon size={17} aria-hidden="true" />{label}</Tabs.Trigger>)}</Tabs.List>
    {metrics}<div className="workspace-layout"><aside className="workspace-inspector" aria-label="Publicación y enlace">{inspector}</aside><div className="workspace-content">
      {[["resumen", overview], ["datos", data], ["imagenes", images], ["apariencia", appearance], ["ajustes", settings]].map(([value, content]) => <Tabs.Content key={value as string} value={value as string} forceMount className="workspace-panel">{content}</Tabs.Content>)}
    </div></div>
  </Tabs.Root>;
}

export function RefreshStatistics() {
  const router = useRouter(); const [pending, startTransition] = useTransition();
  return <button className="button button-secondary" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "Actualizando…" : "Actualizar estadísticas"}</button>;
}
