import { createScene } from '../scene.mjs';

export function createPublicScene() {
  const base = { x: -145, y: -70, w: 290, d: 132, r: 6 };
  const scene = createScene({ label: 'Archivador de consulta pública', base,
    points: [[-145, -70, -12], [145, -70, -12], [-145, 62, -12], [145, 62, -12], [-52, -63, 154], [52, -3, 154]],
    pad: 62, azimuth: 54, elevation: 28 });
  const { box, k, P, line, screws } = scene;
  for (const [x, y] of [[-130, -58], [114, -58], [-130, 44], [114, 44]]) {
    box(`foot-${x}-${y}`, x, y, 16, 12, -12, 6, { tone: 'lo', r: 2 });
  }
  box('base', -145, -70, 290, 132, -6, 6, { tone: 'lo', r: 6,
    inner: line(k.planOutline(k.insetPlan(base, 4), 0, P)) + screws(base, 0) });
  box('cabinet-plinth', -56, -66, 112, 66, 0, 6, { tone: 'lo', r: 2 });

  box('delivery-bed', -130, 12, 260, 36, 0, 12, { tone: 'lo', r: 2 });
  for (const y of [16, 40]) {
    box(`continuous-guide-${y}`, -128, y, 256, 4, 12, 4, { r: 0.5 });
  }
  for (const y of [12, 44]) box(`guard-${y}`, -128, y, 256, 4, 12, 3, { tone: 'lo', r: 0.5 });
  for (const x of [-130, 126]) box(`end-stop-${x}`, x, 20, 4, 20, 12, 7, { r: 0.7 });
  for (const x of [-112, 98]) box(`bed-mount-${x}`, x, 48, 14, 5, 0, 6, { tone: 'lo' });

  box('cabinet-back', -52, -63, 104, 6, 6, 140, { tone: 'lo' });
  for (const x of [-52, 46]) {
    const face = x === 46 ? 52 : -52;
    const rectangle = (y, z, d, h) => k.pathOf([[face, y, z], [face, y + d, z], [face, y + d, z + h], [face, y, z + h]].map(point => k.iso(point, P)), true);
    const vents = Array.from({ length: 7 }, (_, i) => line(rectangle(-48 + i * 5, 119, 2, 12), 'faint')).join('');
    box(`cabinet-side-${x}`, x, -57, 6, 54, 6, 140, { r: 0.5,
      inner: line(rectangle(-53, 12, 46, 128)) + vents });
  }
  box('cabinet-sill', -46, -57, 92, 54, 6, 14, { tone: 'mid' });
  box('cabinet-roof', -52, -63, 104, 60, 146, 4, { tone: 'mid' });
  box('cabinet-cornice', -54, -65, 108, 64, 150, 4, { tone: 'lo', r: 1.2,
    inner: line(k.planOutline({ x: -39, y: -60, w: 78, d: 54, r: 1 }, 154, P)) });
  for (const x of [-48, 40]) box(`roof-cleat-${x}`, x, -61, 8, 56, 154, 2, { tone: 'lo', r: 0.5 });

  for (const [index, z] of [26, 62, 98].entries()) {
    const drawer = { x: -46, y: -57, w: 92, d: 50, r: 0.7 };
    box(`drawer-${index}`, drawer.x, drawer.y, drawer.w, drawer.d, z, 27, { tone: 'mid',
      inner: line(k.sideSeam(drawer, z + 4, P, 5)) });
    box(`drawer-front-${index}`, -46, -7, 92, 4, z, 27, { tone: 'hi',
      inner: screws({ x: -46, y: -7, w: 92, d: 4, r: 1 }, z + 27) });
    for (const x of [-18, 14]) box(`pull-foot-${index}-${x}`, x, -3, 4, 5, z + 13, 4, { r: 0.4 });
    box(`pull-bar-${index}`, -18, 2, 36, 3, z + 13, 4, { r: 0.5 });
    box(`drawer-label-${index}`, -12, -3, 24, 0.8, z + 3, 6, { tone: 'lo', r: 0.2 });
  }

  box('window-back-jamb', -3, 12, 6, 4, 15, 25, { tone: 'hi', r: 0.5 });
  box('window-front-jamb', -3, 44, 6, 4, 15, 25, { tone: 'hi', r: 0.5 });
  box('window-lintel', -3, 12, 6, 36, 40, 4, { tone: 'hi', r: 0.5 });
  box('window-crown', -4, 11, 8, 38, 44, 2, { tone: 'lo', r: 0.5 });
  box('window-nameplate', -4, 20, 1, 20, 40, 3, { tone: 'lo', r: 0.2 });

  box('selector-panel', -42, -3, 32, 3, 130, 13, { tone: 'hi', r: 0.5 });
  for (const x of [-38, -29, -20]) box(`code-key-${x}`, x, 0, 5, 3, 133, 6, { tone: 'mid', r: 0.4 });
  box('access-panel', 10, -3, 32, 3, 130, 13, { tone: 'hi', r: 0.5 });
  for (const x of [15, 30]) box(`access-key-${x}`, x, 0, 6, 3, 132, 5, { tone: 'mid', r: 0.4 });
  box('credential-slot', 16, 0, 20, 0.8, 140, 1, { tone: 'lo', r: 0.2 });
  box('control-lintel', -46, -7, 92, 4, 127, 19, { tone: 'mid', r: 0.5 });

  const card = { x: -14, y: 17, w: 28, d: 26, r: 1.4 };
  const print = [0, 5, 10].map((dy, i) => line(k.lineOnTop([-9, 23 + dy], [8 - i * 3, 23 + dy], 18, P), 'lo', true)).join('');
  box('delivered-record', card.x, card.y, card.w, card.d, 16, 2, { tone: 'lit', r: 1.4, inner: print, moving: true });
  return scene;
}
