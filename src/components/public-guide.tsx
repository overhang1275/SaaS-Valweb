"use client";

import { useRef, useState } from "react";
import { publicInitial, publicTransition, publicView } from "../../manuales/figuras/consulta/model.mjs";
import { HowToFigure, type HowToFigureData } from "./howto-figure";
import { useGuideTour } from "./use-guide-tour";

const steps = [{ type: "set", key: "protected", value: true }, { type: "consult" }, { type: "set", key: "access", value: true }, { type: "consult" }, { type: "revoke" }, { type: "reset" }];
const fields = ["folio", "alfanum", "tipo"] as const;

export function PublicGuide({ figure }: { figure: HowToFigureData }) {
  const [state, setState] = useState(publicInitial);
  const region = useRef<HTMLElement>(null);
  const tour = useGuideTour(region, step => setState(previous => publicTransition(step % steps.length === 0 ? publicInitial() : previous, steps[step % steps.length])));
  const view = publicView(state);
  const act = (action: { type: string; key?: string; value?: boolean | string[] }) => { tour.stop(); setState(previous => publicTransition(previous, action)); };
  const access = !state.protected ? "open" : state.access ? "allowed" : "denied";
  return <section className="howto-demo" aria-label="Simulación de consulta pública" ref={region}>
    <div className="howto-demo-heading"><div><h3>Del permiso al documento</h3><p>Prueba una consulta ficticia. Conocer el código y tener acceso son condiciones distintas.</p></div></div>
    <div className="howto-demo-layout"><div className="howto-demo-visual">
      <HowToFigure figure={figure} target={view.position} frame={{ number: "Fig. 03", title: "Archivador de consulta", hint: "Configura el acceso y consulta el código", readout: view.delivered ? "Ficha recibida" : "Sin entrega" }} />
      <div className="howto-demo-status" role="status" aria-live={tour.touring ? "off" : "polite"} aria-atomic="true"><h3>{view.delivered ? "Última ficha recibida" : "La ficha espera"}</h3><p>{view.readout}</p></div>
      <div className="howto-published">{view.delivered ? <><strong>Resultado del ejemplo</strong>{view.fields.map((field: { label: string; value: string }) => <span key={field.label}>{field.label}: <strong>{field.value}</strong></span>)}<span>Imagen: <strong>{view.image ? "entregada" : view.imageUnavailable ? "no disponible" : "oculta"}</strong></span></> : <span>Ningún registro entregado.</span>}</div>
    </div><div className="howto-demo-controls" onFocusCapture={event => { if (!(event.target as HTMLElement).closest("[data-tour]")) tour.stop(); }}>
      <div className="field"><label htmlFor="public-availability">Estado del enlace</label><select id="public-availability" value={!state.active ? "inactive" : !state.published ? "unpublished" : "ready"} onChange={event => { act({ type: "set", key: "active", value: event.target.value !== "inactive" }); act({ type: "set", key: "published", value: event.target.value !== "unpublished" }); }}><option value="ready">Activo y base publicada</option><option value="inactive">Enlace inactivo</option><option value="unpublished">Base sin publicar</option></select></div>
      <div className="field"><label htmlFor="public-access">Acceso a la consulta</label><select id="public-access" value={access} onChange={event => { act({ type: "set", key: "protected", value: event.target.value !== "open" }); act({ type: "set", key: "access", value: event.target.value === "allowed" }); }}><option value="open">Público, sin cuenta</option><option value="denied">Protegido, sin permiso</option><option value="allowed">Protegido, con permiso</option></select></div>
      <div className="field"><label htmlFor="public-code">Código del ejemplo</label><select id="public-code" value={state.knownCode ? "known" : "unknown"} onChange={event => act({ type: "set", key: "knownCode", value: event.target.value === "known" })}><option value="known">ABC101 · registrado</option><option value="unknown">XYZ999 · inexistente</option></select></div>
      <div className="field"><label htmlFor="public-image">Imagen del resultado</label><select id="public-image" value={!state.showImage ? "hidden" : state.imageAvailable ? "available" : "missing"} onChange={event => { act({ type: "set", key: "showImage", value: event.target.value !== "hidden" }); act({ type: "set", key: "imageAvailable", value: event.target.value === "available" }); }}><option value="available">Disponible</option><option value="missing">No disponible</option><option value="hidden">Oculta en el resultado</option></select></div>
      <fieldset className="howto-fieldset"><legend>Campos visibles</legend>{fields.map(field => <label key={field} className="howto-check"><input type="checkbox" checked={state.selectedFields.includes(field)} onChange={event => act({ type: "set", key: "selectedFields", value: event.target.checked ? [...state.selectedFields, field] : state.selectedFields.filter((value: string) => value !== field) })} />{field}</label>)}</fieldset>
      <div className="howto-demo-actions"><button className="button" type="button" onClick={() => act({ type: "consult" })}>Consultar código</button><button className="button button-secondary" type="button" disabled={!state.active} onClick={() => act({ type: "revoke" })}>Revocar enlace</button><button className="button button-secondary" type="button" onClick={() => act({ type: "reset" })}>Reiniciar consulta</button></div>
      <button className="button button-secondary" type="button" data-tour aria-pressed={tour.touring} onClick={() => { if (!tour.touring && !tour.manual) setState(publicInitial()); tour.toggle(); }}>{tour.manual ? "Ver siguiente paso" : tour.touring ? "Pausar recorrido" : "Reproducir recorrido"}</button>
      <p className="help">Revocar bloquea nuevas entregas; la ficha ya recibida permanece. Quien recibe una imagen puede capturarla.</p>
    </div></div>
  </section>;
}
