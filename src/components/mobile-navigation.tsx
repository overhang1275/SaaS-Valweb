"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Navigation } from "./navigation";
import { Brand } from "./brand";
import { LogoutButton } from "./logout-button";

export function MobileNavigation({ admin, workspace, name }: { admin: boolean; workspace: string; name: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button className="icon-button mobile-menu-button" aria-label="Abrir navegación"><Menu size={22} /></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay sheet-overlay" /><Dialog.Content className="navigation-sheet">
    <Dialog.Title className="sr-only">Navegación de Valweb</Dialog.Title><Dialog.Description className="sr-only">Secciones disponibles para {workspace}.</Dialog.Description><div className="sheet-header"><Brand /><Dialog.Close asChild><button className="icon-button" aria-label="Cerrar navegación"><X size={20} /></button></Dialog.Close></div><p className="scope-label">{workspace}</p><Navigation admin={admin} onNavigate={() => setOpen(false)} /><div className="sheet-footer"><p>{name}</p><LogoutButton /></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
