"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

type Confirm = (message: string) => Promise<boolean>;
const Context = createContext<Confirm | null>(null);
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  function finish(value: boolean) { const resolve = resolver.current; resolver.current = null; setMessage(null); resolve?.(value); }
  const confirm: Confirm = message => new Promise(resolve => {
    resolver.current?.(false); resolver.current = resolve;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMessage(message);
  });
  return <Context.Provider value={confirm}>{children}<AlertDialog.Root open={message !== null} onOpenChange={open => { if (!open) finish(false); }}>
    <AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="dialog-content" onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); }}>
      <ShieldAlert className="dialog-symbol" size={28} aria-hidden="true" /><AlertDialog.Title>Confirmar acción</AlertDialog.Title><AlertDialog.Description>{message}</AlertDialog.Description>
      <div className="dialog-actions"><AlertDialog.Cancel asChild><button className="button button-secondary" onClick={() => finish(false)}>Cancelar</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="button" onClick={() => finish(true)}>Confirmar</button></AlertDialog.Action></div>
    </AlertDialog.Content></AlertDialog.Portal>
  </AlertDialog.Root></Context.Provider>;
}
export function useConfirm() {
  const confirm = useContext(Context); if (!confirm) throw new Error("ConfirmationProvider is required"); return confirm;
}
