import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createImagesScene } from './imagenes/geometry.mjs';
import { createPublicScene } from './consulta/geometry.mjs';
import { plateHtml, pageHtml } from './carga-csv/vendor/iso-kit.mjs';

const root = new URL('../../', import.meta.url);
const license = `<!-- ${readFileSync(new URL('carga-csv/vendor/LICENSE', import.meta.url), 'utf8')} -->\n`;
const output = new URL('output/anatomy-sections/', root);
mkdirSync(output, { recursive: true });
mkdirSync(new URL('src/features/help/', root), { recursive: true });
for (const [name, number, title, make] of [
  ['images', 'Fig. 02', 'Estación de revelado', createImagesScene],
  ['public', 'Fig. 03', 'Archivador de consulta', createPublicScene],
]) {
  const scene = make();
  if (process.argv.includes('--audit')) console.log(`${name}: ${scene.audit()}`);
  const data = scene.finish();
  data.svg = license + data.svg;
  writeFileSync(new URL(`src/features/help/${name}-figure.json`, root), JSON.stringify(data));
  for (const theme of ['light', 'dark']) for (const position of [-100, 0, 100]) {
    const body = plateHtml({ fig: number, title, hint: 'Simulación didáctica', readout: `${position}`, caption: title, body: scene.svg(position, theme) });
    writeFileSync(new URL(`${name}-${theme}-${position}.html`, output), license + pageHtml({ title, theme, body }));
  }
  console.log(`${name}: ${data.pieceCount} piezas; JSON y vistas de inspección generados`);
}
