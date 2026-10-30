"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";

export function TenantNameForm({ action, id, name, cancelHref }: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  id: string;
  name: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const errorId = useId();
  const fieldError = state.fieldErrors?.name;

  return <form action={formAction} className="tenant-name-form">
    <input type="hidden" name="id" value={id} />
    <div className="field">
      <label htmlFor="tenant-name">Nombre de la cuenta</label>
      <input id="tenant-name" name="name" autoComplete="organization" maxLength={120} required defaultValue={name} aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? errorId : undefined} />
      {fieldError && <p className="field-error" id={errorId} role="alert">{fieldError}</p>}
    </div>
    <div className="tenant-name-actions">
      <button className="button" disabled={pending} type="submit">{pending ? "Guardando…" : "Guardar cambios"}</button>
      <Link className="button button-secondary" href={cancelHref}>Cancelar</Link>
      {state.status === "error" && !fieldError && <p className="feedback error" role="alert">{state.message}</p>}
      {state.status === "success" && <p className="feedback success" role="status" aria-live="polite">{state.message}</p>}
    </div>
  </form>;
}
