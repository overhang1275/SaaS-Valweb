"use client";

import { useActionState, useId, useRef, type ReactNode } from "react";
import { useConfirm } from "@/components/ui/confirmation";
import { initialActionState, type ActionState } from "@/lib/action-state";

export function ActionForm({ action, children, label, pendingLabel = "Guardando…", compact = false, confirmMessage, resetOnSuccess = false, disabled = false }: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children?: ReactNode;
  label: string;
  pendingLabel?: string;
  compact?: boolean;
  confirmMessage?: string;
  resetOnSuccess?: boolean;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const messageId = useId();
  const confirm = useConfirm();
  const approved = useRef(false);
  return <form action={formAction} className={compact ? "inline-form" : "stack"} aria-describedby={state.message ? messageId : undefined} onSubmit={async event => {
    if (!confirmMessage) return;
    if (approved.current) { approved.current = false; return; }
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (await confirm(confirmMessage) && form.isConnected) { approved.current = true; form.requestSubmit(submitter); }
  }}>
    {(!resetOnSuccess || state.status !== "success") && <>
      {children}
      <button className={compact ? "button button-secondary" : "button"} disabled={pending || disabled} type="submit">{pending ? pendingLabel : label}</button>
    </>}
    <div id={messageId} role={state.status === "error" ? "alert" : "status"} aria-live="polite">
      {state.message && <p className={`feedback ${state.status}`}>{state.message}</p>}
    </div>
  </form>;
}
