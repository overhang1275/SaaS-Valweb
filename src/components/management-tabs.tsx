"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export function ManagementTabs({ listLabel, formLabel, formValue, list, form }: {
  listLabel: string; formLabel: string; formValue: string; list: ReactNode; form?: ReactNode;
}) {
  const search = useSearchParams();
  const selected = search.get("tab") === formValue ? formValue : "lista";
  if (!form) return <>{list}</>;
  return <Tabs.Root className="management-tabs" value={selected} onValueChange={value => {
    const url = new URL(window.location.href);
    if ((url.searchParams.get("tab") || "lista") === value) return;
    if (value === "lista") url.searchParams.delete("tab"); else url.searchParams.set("tab", value);
    url.hash = "";
    window.history.pushState(null, "", url);
  }}>
    <Tabs.List className="workspace-tabs" aria-label={`Secciones de ${listLabel.toLowerCase()}`}><Tabs.Trigger className="workspace-tab" value="lista">Listado</Tabs.Trigger><Tabs.Trigger className="workspace-tab" value={formValue}>{formLabel}</Tabs.Trigger></Tabs.List>
    <Tabs.Content className="workspace-panel" value="lista" forceMount>{list}</Tabs.Content>
    <Tabs.Content className="workspace-panel" value={formValue} forceMount>{form}</Tabs.Content>
  </Tabs.Root>;
}
