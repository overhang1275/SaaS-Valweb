"use client";

import { useRef, useState } from "react";
import { imageInitial, imageTransition, imageView } from "../../manuales/figuras/imagenes/model.mjs";
import { HowToFigure, type HowToFigureData } from "./howto-figure";
import { useGuideTour } from "./use-guide-tour";

const steps = [{ type: "scenario", value: "replacement" }, { type: "process" }, { type: "confirm" }, { type: "scenario", value: "cleanup-failure" }, { type: "process" }, { type: "cleanup" }, { type: "reset" }];

export function ImagesGuide({ figure }: { figure: HowToFigureData }) {
  const [state, setState] = useState(imageInitial);
  const region = useRef<HTMLElement>(null);
  const tour = useGuideTour(region, step => setState(previous => imageTransition(step % steps.length === 0 ? imageInitial() : previous, steps[step % steps.length])));
  const view = imageView(state);
  const act = (action: { type: string; value?: string | boolean }) => { tour.stop(); setState(previous => imageTransition(previous, action)); };
  return <section className="howto-demo" aria-label="Simulación de imágenes" ref={region}>
    <div className="howto-demo-heading"><div><h3>Del original a la copia publicada</h3><p>Simula un archivo ABC101.png. No se procesan imágenes reales.</p></div></div>
    <div className="howto-demo-layout"><div className="howto-demo-visual">
      <HowToFigure figure={figure} target={view.position} frame={{ number: "Fig. 02", title: "Estación de revelado", hint: "Elige un caso y pulsa Procesar", readout: view.title }} />
      <div className="howto-demo-status" role="status" aria-live={tour.touring ? "off" : "polite"} aria-atomic="true"><h3>{view.title}</h3><p>{view.detail}</p></div>
      <div className="howto-published"><span>Destino: <strong>{state.storage}</strong></span><span>Copia procesada: <strong>{view.published ? "publicada" : "sin publicar"}</strong></span><span>Original: <strong>{view.originalPresent ? "conservado en por_procesar/" : "retirado tras publicar"}</strong></span></div>
    </div><div className="howto-demo-controls" onFocusCapture={event => { if (!(event.target as HTMLElement).closest("[data-tour]")) tour.stop(); }}>
      <div className="field"><label htmlFor="image-case">Caso de imágenes</label><select id="image-case" value={state.scenario} onChange={event => act({ type: "scenario", value: event.target.value })}><option value="new">Imagen nueva</option><option value="replacement">Reemplazo existente</option><option value="error">Archivo con errores</option><option value="cleanup-failure">Fallo de limpieza posterior</option></select></div>
      <div className="field"><label htmlFor="image-storage">Destino de ejemplo</label><select id="image-storage" value={state.storage} onChange={event => act({ type: "storage", value: event.target.value })}><option value="LOCAL">Local</option><option value="NFS">NFS</option></select></div>
      <label className="howto-check"><input type="checkbox" checked={state.available} onChange={event => act({ type: "availability", value: event.target.checked })} />Destino disponible</label>
      <div className="howto-demo-actions"><button className="button" type="button" disabled={!view.canProcess} onClick={() => act({ type: "process" })}>Procesar imagen</button><button className="button button-secondary" type="button" disabled={!view.canConfirm} onClick={() => act({ type: "confirm" })}>Confirmar reemplazo</button><button className="button button-secondary" type="button" disabled={!view.canCleanup} onClick={() => act({ type: "cleanup" })}>Reintentar limpieza</button><button className="button button-secondary" type="button" onClick={() => act({ type: "reset" })}>Reiniciar imágenes</button></div>
      <button className="button button-secondary" type="button" data-tour aria-pressed={tour.touring} onClick={() => { if (!tour.touring && !tour.manual) setState(imageInitial()); tour.toggle(); }}>{tour.manual ? "Ver siguiente paso" : tour.touring ? "Pausar recorrido" : "Reproducir recorrido"}</button>
      <p className="help">Depositar el original por FTP no inicia el lote. Un fallo NFS conserva ese destino y nunca cambia a Local por sí solo. Cambiar de caso reinicia la demostración.</p>
    </div></div>
  </section>;
}
