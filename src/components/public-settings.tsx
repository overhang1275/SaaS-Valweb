"use client";

import { useActionState, useState } from "react";
import { publicSettingsAction } from "@/features/validations/actions";
import { initialActionState } from "@/lib/action-state";
import { useHydrated } from "@/lib/use-hydrated";

type Settings = { imageMode: "SHARED" | "PER_RECORD"; showFolio: boolean; showAlfanum: boolean; showTipo: boolean; showOtro: boolean; showImage: boolean; requireClientAccess: boolean };
export function PublicSettings({ id, initial, canManageAccess }: { id: string; initial: Settings; canManageAccess: boolean }) {
  const [values, setValues] = useState(initial);
  const ready = useHydrated();
  const [state, action, pending] = useActionState(publicSettingsAction, initialActionState);
  return <section className="publication-section surface public-settings" aria-labelledby="result-settings-title"><h2 id="result-settings-title">Resultado público</h2><p className="help">La búsqueda siempre se realiza por alfanumérico. Elige qué datos mostrar al encontrarlo.</p><form action={action} className="stack">
    <input type="hidden" name="id" value={id} />
    <div className="field"><label htmlFor="result-image-mode">Modo de imágenes</label><select id="result-image-mode" name="imageMode" disabled={!ready || pending} value={values.imageMode} onChange={event => setValues({ ...values, imageMode: event.target.value as Settings["imageMode"] })}><option value="PER_RECORD">Una imagen por alfanumérico (carga masiva)</option><option value="SHARED">Una imagen general para todos</option></select></div>
    <fieldset className="output-fields" disabled={!ready || pending}><legend>Mostrar en el resultado</legend>{([["showFolio", "Folio"], ["showAlfanum", "Alfanumérico"], ["showTipo", "Tipo de documento"], ["showOtro", "Otros"], ["showImage", "Imagen"]] as const).map(([key, label]) => <label className="checkbox-row" key={key}><input type="checkbox" name={key} checked={values[key]} onChange={event => setValues({ ...values, [key]: event.target.checked })} />{label}</label>)}</fieldset>
    {canManageAccess && <fieldset className="output-fields" disabled={!ready || pending}><legend>Acceso al enlace</legend><label className="checkbox-row"><input type="checkbox" name="requireClientAccess" checked={values.requireClientAccess} onChange={event => setValues({ ...values, requireClientAccess: event.target.checked })} />Solicitar acceso con cuenta de cliente</label><p className="help">El cliente inicia sesión con su correo y contraseña. La cuenta debe pertenecer al cliente asignado a esta validación.</p></fieldset>}
    <p className="help">Los cambios en los datos mostrados desactivan la validación para que revises el resultado antes de volver a habilitarla.</p>
    <div><button className="button button-secondary" disabled={!ready || pending}>{pending ? "Guardando…" : "Guardar configuración"}</button></div>
    <div role={state.status === "error" ? "alert" : "status"} aria-live="polite">{state.message && <p className={`feedback ${state.status}`}>{state.message}</p>}</div>
  </form></section>;
}
