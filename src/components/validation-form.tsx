"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";

type Texts = { name: string; title: string; instructions: string; successMessage: string; errorMessage: string; imageAlt: string };
const defaults: Texts = {
  name: "", title: "", instructions: "Captura tu código alfanumérico para consultar el resultado.",
  successMessage: "Registro encontrado.", errorMessage: "No encontramos el alfanumérico. Revisa e inténtalo de nuevo.",
  imageAlt: "Resultado de la validación",
};
const fields = [
  { key: "name", label: "Nombre interno", max: 120, help: "Solo lo verá tu equipo en el panel.", multiline: false },
  { key: "title", label: "Título público", max: 160, help: "Título que verá quien consulte el enlace cuando se publique.", multiline: false },
  { key: "instructions", label: "Instrucciones", max: 2000, help: "Explica cómo capturar el código alfanumérico. Campo opcional.", multiline: true },
  { key: "successMessage", label: "Mensaje de éxito", max: 500, help: "Se mostrará cuando el registro exista.", multiline: true },
  { key: "errorMessage", label: "Mensaje de error", max: 500, help: "Se mostrará cuando el registro no exista.", multiline: true },
  { key: "imageAlt", label: "Descripción de la imagen", max: 500, help: "Describe el contenido para quienes utilizan lectores de pantalla.", multiline: true },
] as const;
const subscribe = () => () => {};

export function ValidationForm({ action, initial, id, tenants }: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  initial?: Texts;
  id?: string;
  tenants?: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const [texts, setTexts] = useState(initial ?? defaults);
  const [tenantId, setTenantId] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  // Preserve early edits by enabling controlled fields only after hydration.
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  useEffect(() => {
    if (state.status === "error") formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  return <form ref={formRef} action={formAction} className="stack validation-form" aria-describedby="validation-feedback">
    {id && <input type="hidden" name="id" value={id} />}
    <fieldset className="stack validation-fields" disabled={!ready || pending}>
    <legend className="sr-only">Datos y textos de la validación</legend>
    {tenants && <div className="field">
      <label htmlFor="validation-tenant">Cuenta del cliente</label>
      <select id="validation-tenant" name="tenantId" required value={tenantId} onChange={event => setTenantId(event.target.value)} aria-invalid={Boolean(state.fieldErrors?.tenantId)} aria-describedby="tenant-help">
        <option value="" disabled>Selecciona una cuenta</option>
        {tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
      </select>
      <p className="help" id="tenant-help">{state.fieldErrors?.tenantId ?? "La cuenta propietaria no se puede cambiar después."}</p>
    </div>}
    {fields.map(field => {
      const error = state.fieldErrors?.[field.key];
      const props = {
        id: `validation-${field.key}`, name: field.key, value: texts[field.key],
        maxLength: field.max, required: field.key !== "instructions",
        "aria-describedby": `${field.key}-help`, "aria-invalid": Boolean(error),
        onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          const value = event.target.value;
          setTexts(previous => ({ ...previous, [field.key]: value }));
        },
      };
      return <div className="field" key={field.key}>
        <label htmlFor={props.id}>{field.label}</label>
        {field.multiline ? <textarea {...props} rows={field.key === "instructions" ? 4 : 3} /> : <input {...props} type="text" />}
        <p id={`${field.key}-help`} className={error ? "field-error" : "help"}>{error ?? `${field.help} Máximo ${field.max} caracteres.`}</p>
      </div>;
    })}
    {!id && <div className="field"><label htmlFor="image-mode">Modo de imágenes</label><select id="image-mode" name="imageMode" defaultValue="PER_RECORD"><option value="PER_RECORD">Una imagen por alfanumérico (carga masiva)</option><option value="SHARED">Una imagen general para todos</option></select></div>}
    <div className="form-controls"><button className="button" type="submit" disabled={pending}>{pending ? "Guardando…" : id ? "Guardar cambios" : "Crear validación"}</button></div>
    </fieldset>
    <div id="validation-feedback" role={state.status === "error" ? "alert" : "status"} aria-live="polite">
      {state.message && <p className={`feedback ${state.status}`}>{state.message}</p>}
    </div>
  </form>;
}
