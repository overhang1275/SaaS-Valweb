"use client";

import { useState } from "react";
import { HowToFigure, type HowToFigureData } from "./howto-figure";
import { EXAMPLES, describe, initialState, transition, mappingIsValid } from "../../manuales/figuras/carga-csv/model.mjs";

const emptyMapping = { folio: "", alfanum: "", tipo: "" };
const columns = ["folio", "alfanum", "tipo"] as const;

export function CsvGuide({ figure }: { figure: HowToFigureData }) {
  const [state, setState] = useState(initialState);
  const [mapping, setMapping] = useState(emptyMapping);
  const view = describe(state);
  const rows = EXAMPLES[state.example === "errors" ? "errors" : "valid"];
  const act = (action: string) => setState(previous => transition(previous, action));

  return <section className="howto-demo" aria-label="Simulación de carga CSV">
    <div className="howto-demo-heading"><div><h3>Practica con un CSV de ejemplo</h3><p>Datos ficticios. Puedes probar sin modificar tus validaciones.</p></div><span className="help">Demostración interactiva</span></div>
    <div className="howto-demo-layout">
      <div className="howto-demo-visual">
        <HowToFigure figure={figure} target={view.position} />
        <div className="howto-demo-status" role="status" aria-live="polite" aria-atomic="true"><span className="help">Paso {view.step + 1} de 4</span><h3>{view.title}</h3><p>{view.detail}</p></div>
        <div className="howto-published"><span>Base del ejemplo: <strong>{state.published} registros publicados</strong></span><span>Enlace: <strong>pendiente de activación</strong></span></div>
      </div>
      <div className="howto-demo-controls">
        <div className="field"><label htmlFor="csv-example">Archivo de ejemplo</label><select id="csv-example" value={state.example} onChange={event => { setState(previous => ({ ...initialState(event.target.value), published: previous.published })); setMapping(emptyMapping); }}><option value="valid">Sin errores</option><option value="errors">Con código duplicado</option></select></div>
        <table className="howto-sample"><caption>CSV UTF-8 · tres registros ficticios</caption><thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.folio}>{columns.map(column => <td key={column}>{row[column]}</td>)}</tr>)}</tbody></table>
        {columns.map(column => <div className="field" key={column}><label htmlFor={`csv-map-${column}`}>Columna de {column}</label><select id={`csv-map-${column}`} value={mapping[column]} disabled={!view.canMap} onChange={event => { setMapping(previous => ({ ...previous, [column]: event.target.value })); act("clear-map"); }}><option value="">Selecciona una columna</option>{columns.map(source => <option key={source} value={source}>{source}</option>)}</select></div>)}
        <div className="howto-demo-actions"><button type="button" className="button button-secondary" onClick={() => act("load")}>{state.stage === "empty" ? "1. Cargar ejemplo" : "Volver a cargar"}</button><button type="button" className="button button-secondary" disabled={!view.canMap} onClick={() => act(mappingIsValid(mapping) ? "map" : "wrong-map")}>2. Asignar columnas</button><button type="button" className="button button-secondary" disabled={!view.canProcess} onClick={() => act("process")}>3. Procesar</button><button type="button" className="button" disabled={!view.canPublish} onClick={() => act("publish")}>4. Publicar</button></div>
        <p className="help">El folio conserva sus ceros iniciales. La búsqueda usa el alfanumérico.</p>
      </div>
    </div>
  </section>;
}
