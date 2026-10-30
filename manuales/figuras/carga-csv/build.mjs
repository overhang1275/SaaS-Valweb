import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figure, axis, motionOrders, audit, pieceCount } from './geometry.mjs';
import { ISO_CSS } from './vendor/iso-kit.mjs';

const here = name => new URL(name, import.meta.url);
const read = name => readFileSync(here(name), 'utf8');
const theme = process.argv.includes('--dark') ? 'dark' : 'light';
const model = read('model.mjs').replaceAll('export ', '');
const live = read('live.mjs').replace(/^import .*;\n/, '').replace('export ', '');
const license = `<!-- Anatomy iso-kit, Copyright (c) 2026 Ryan, MIT.\n${read('vendor/LICENSE')}-->`;
const controls = `<div id="interactive" hidden>
  <div class="legend"><span>Ficha: base candidata</span><span>Mesa: proceso de revisión</span></div>
  <div class="workspace">
    <section class="controls" aria-labelledby="sample-title">
      <h2 id="sample-title">Prueba con tres registros</h2>
      <div class="field"><label for="example">CSV de demostración</label><select id="example"><option value="valid">Sin errores</option><option value="errors">Con un código duplicado</option></select></div>
      <table><caption class="sample-note">Datos ficticios · CSV UTF-8</caption><thead><tr><th scope="col">folio</th><th scope="col">alfanum</th></tr></thead><tbody id="rows"></tbody></table>
      <p class="sample-note">El folio es texto: 0001 conserva sus ceros. La búsqueda usa el alfanumérico.</p>
      <div class="field"><label for="mapping">Columna para buscar</label><select id="mapping" disabled><option value="alfanum">alfanum → alfanumérico</option><option value="folio">folio → alfanumérico (incorrecto)</option></select></div>
      <div class="actions"><button id="load">1. Cargar ejemplo</button><button id="map" disabled>2. Asignar columnas</button><button id="process" disabled>3. Procesar</button><button id="publish" class="primary" disabled>4. Publicar</button></div>
    </section>
    <section aria-label="Estado del ejemplo">
      <ol class="steps"><li aria-current="step"><b>01</b>Carga</li><li><b>02</b>Mapeo</li><li><b>03</b>Revisión</li><li><b>04</b>Publicación</li></ol>
      <div id="status" role="status" aria-live="off" aria-atomic="true"><h2 id="state-title">Antes de cargar</h2><p id="detail">Elige un CSV de ejemplo.</p></div>
      <div class="published"><p><strong id="base-state">Sin base publicada</strong> · <span id="published-count">0</span> registros del ejemplo</p><p>Enlace: <strong>pendiente de activación</strong></p></div>
      <div class="actions"><button id="tour" aria-pressed="false">Reproducir recorrido</button></div>
      <p class="sample-note">Simulación educativa. Los pasos no representan tiempos reales ni modifican Valweb.</p>
    </section>
  </div>
</div>`;

const html = `<!doctype html>
${license}
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Cargar, revisar y publicar un CSV · Valweb</title><style>${ISO_CSS}\n${read('style.css')}</style></head>
<body class="iso" data-theme="${theme}"><main>
<header><strong>VALWEB / COMPUTER FORMS</strong><a href="../../panel-administracion-admin.md">Volver al manual</a></header>
<h1>Cargar no es publicar.</h1>
<p class="intro">Un archivo entra. El worker revisa sus registros. Tú decides cuándo la base candidata pasa a ser la base publicada.</p>
<figure class="figure iso-plate" aria-labelledby="figure-title"><figcaption class="figure-top"><span>FIG. 01 · CSV</span><strong id="figure-title">Mesa de inspección de registros</strong></figcaption><div class="stage">${figure()}</div><div class="figure-bottom"><span>Sigue la ficha: entrada → revisión → publicación</span><output data-readout>Antes de cargar</output></div></figure>
${controls}
<section class="explanation" aria-labelledby="how-title"><h2 id="how-title">Lo que cambia en cada paso</h2><ol>
<li><strong>Cargar:</strong> se recibe el CSV. La base publicada se conserva.</li>
<li><strong>Mapear:</strong> se asignan las columnas folio y alfanum. El folio no es la clave de búsqueda.</li>
<li><strong>Procesar y revisar:</strong> el worker valida todos los registros. Los errores se corrigen en el archivo y se vuelve a cargar. Una candidata válida espera tu revisión.</li>
<li><strong>Publicar:</strong> la candidata sustituye la base publicada. El enlace necesita activarse por separado; revisa cuenta activa, registros e imágenes requeridas en el panel.</li>
</ol></section>
<noscript><p>La simulación interactiva necesita JavaScript. La figura y la explicación de los cuatro pasos siguen disponibles sin él.</p></noscript>
<footer><span>Material de capacitación · sin conexión a datos reales</span><a href="carga-csv.svg">Abrir figura estática</a></footer>
</main><script>${model}\n${live}\nmount(${JSON.stringify({ axis, ...motionOrders() })});</script></body></html>`;

if (process.argv.includes('--audit')) console.log(audit());
const output = theme === 'dark' ? 'oscuro.html' : 'index.html';
writeFileSync(here(output), html);
if (theme === 'light') writeFileSync(here('carga-csv.svg'), license + '\n' + figure(0, 'light'));
console.log(`${fileURLToPath(here(output))} · ${pieceCount} piezas · HTML autónomo`);
