import { createScene } from '../scene.mjs';

export function createImagesScene() {
  const scene = createScene({
    label: 'Ampliadora fotográfica con bandeja de originales, cabezal de revisión y archivo de copias. La fotografía se desliza hacia la publicación solo si el lote puede publicarse.',
    base: { x: -155, y: -67, w: 310, d: 150, r: 7 },
    points: [[-155, -67, -14], [-155, 83, -14], [155, -67, -14], [155, 83, -14], [-26, -58, 131], [26, 23, 131]],
    azimuth: 46, elevation: 35, pad: 33,
  });
  const { k, P } = scene;
  const box = (id, x, y, w, d, z, h, tone = 'mid', inner = '', moving = false) =>
    scene.box(id, x, y, w, d, z, h, { tone, r: Math.min(1, w / 5, d / 5), inner, moving });
  const screws = (x, y, w, d, z) => scene.screws({ x, y, w, d, r: 1 }, z);
  const outline = (x, y, w, d, z, inset = 2) => scene.line(k.planOutline({ x: x + inset, y: y + inset, w: w - 2 * inset, d: d - 2 * inset, r: 0.7 }, z, P));

  for (const x of [-143, 131]) for (const y of [-55, 59]) box(`foot-${x}-${y}`, x, y, 12, 12, -14, 4, 'lo');
  box('base-plate', -155, -67, 310, 150, -10, 10, 'lo', outline(-155, -67, 310, 150, 0, 5) + screws(-155, -67, 310, 150, 0));

  // Two uninterrupted rails carry the photo through its entire 200-unit stroke.
  for (const y of [-20, 16]) {
    box(`rail-${y}`, -142, y, 284, 4, 0, 4, 'mid', screws(-142, y, 284, 4, 4));
    for (const x of [-148, 142]) box(`stop-${x}-${y}`, x, y - 2, 6, 8, 0, 8, 'mid', screws(x, y - 2, 6, 8, 8));
  }
  for (const y of [-27, 24]) {
    const ticks = k.topTicks(-134, 134, 5, 5, y, 0.8, [1.3, 2.5], P);
    box(`ruler-${y}`, -138, y, 276, 3, 0, 0.8, 'lo', scene.line(ticks.minor, 'lo') + scene.line(ticks.major, 'mid'));
  }
  for (const x of [-152, 148]) box(`rail-cap-${x}`, x, -28, 4, 57, 0, 3, 'lo', screws(x, -28, 4, 57, 3));

  // A rear column holds the enlarger above the clear travel envelope.
  box('column-plinth', -22, -62, 44, 28, 0, 7, 'lo', screws(-22, -62, 44, 28, 7));
  box('column-lower', -10, -54, 20, 16, 7, 40, 'mid', outline(-10, -54, 20, 16, 47, 3));
  box('column-collar', -14, -58, 28, 24, 47, 6, 'mid', screws(-14, -58, 28, 24, 53));
  box('column-upper', -10, -54, 20, 16, 53, 43, 'mid');
  box('column-cap', -14, -58, 28, 24, 96, 4, 'hi', screws(-14, -58, 28, 24, 100));
  box('enlarger-arm', -9, -50, 18, 61, 100, 5, 'mid', screws(-9, -50, 18, 61, 105));
  box('head-bed', -27, -20, 54, 43, 105, 4, 'lo', screws(-27, -20, 54, 43, 109));
  box('head-body', -24, -17, 48, 37, 109, 12, 'mid');
  box('head-cover', -26, -19, 52, 41, 121, 3, 'mid', screws(-26, -19, 52, 41, 124));
  box('viewfinder-frame', -11, -10, 22, 16, 124, 1.2, 'hi');
  box('viewfinder-glass', -9, -8, 18, 12, 125.2, 0.5, 'lo', outline(-9, -8, 18, 12, 125.7, 1));
  for (const x of [-22, 17]) box(`focus-bracket-${x}`, x, 12, 5, 5, 124, 4, 'mid');
  box('focus-bar', -22, 12, 44, 5, 128, 3, 'hi', screws(-22, 12, 44, 5, 131));
  for (let i = 0; i < 4; i++) box(`head-vent-${i}`, -22 + i * 12, -15, 7, 3, 124, 1.2, 'lo');

  function tray(prefix, x, isArchive) {
    box(`${prefix}-floor`, x, 33, 59, 34, 0, 2, 'lo', outline(x, 33, 59, 34, 2, 2));
    box(`${prefix}-left`, x, 33, 2, 34, 2, 10, 'mid');
    box(`${prefix}-right`, x + 57, 33, 2, 34, 2, 10, 'mid');
    box(`${prefix}-back`, x + 2, 33, 55, 2, 2, 10, 'mid');
    box(`${prefix}-paper-low`, x + 6, 39, 47, 23, 2, 0.8, 'hi');
    box(`${prefix}-paper-top`, x + 8, 41, 43, 20, 2.8, 0.8, 'hi', outline(x + 8, 41, 43, 20, 3.6, 2));
    for (const dx of [5, 49]) {
      box(`${prefix}-${isArchive ? 'divider' : 'clip'}-${dx}`, x + dx, 36, 5, 3, 2, 4, 'mid');
    }
    box(`${prefix}-handle`, x + 18, 64, 23, 3, 2, 4, 'mid', screws(x + 18, 64, 23, 3, 6));
  }
  tray('original', -136, false);
  tray('archive', 77, true);

  const moving = (id, x, y, w, d, z, h, tone = 'mid', inner = '') => box(id, x, y, w, d, z, h, tone, inner, true);
  moving('photo-sled', -25, -22, 50, 44, 4, 3, 'mid', screws(-25, -22, 50, 44, 7));
  moving('photo-carrier', -22, -19, 44, 38, 7, 2, 'hi');
  moving('photo-paper', -19, -16, 38, 32, 9, 0.8, 'hi');
  const photograph = scene.line(k.pathOf([[-11, 7, 10.2], [-4, -5, 10.2], [3, 7, 10.2]].map(point => k.iso(point, P)), true), 'lo')
    + scene.line(k.pathOf([[0, 7, 10.2], [6, -2, 10.2], [11, 7, 10.2]].map(point => k.iso(point, P)), true), 'lo')
    + scene.line(k.ring(7, -6, 1.8, 10.2, P, 24), 'lo');
  moving('photo-subject', -15, -12, 30, 24, 9.8, 0.4, 'lit', outline(-15, -12, 30, 24, 10.2, 2) + photograph);
  for (const x of [-22, 17]) moving(`photo-clip-${x}`, x, -19, 5, 3, 9, 2, 'mid', screws(x, -19, 5, 3, 11));
  for (const x of [-25, 17]) moving(`photo-grip-${x}`, x, 17, 8, 5, 9, 3, 'mid', screws(x, 17, 8, 5, 12));

  for (const [i, x] of [-36, -17].entries()) {
    box(`button-socket-${i}`, x, 46, 14, 15, 0, 2, 'lo', screws(x, 46, 14, 15, 2));
    box(`button-key-${i}`, x + 3, 49, 8, 9, 2, 2, 'hi');
  }
  const textLines = [12, 17, 10].map((length, i) => scene.line(k.lineOnTop([10, 47 + i * 4], [10 + length, 47 + i * 4], 0.8, P), 'lo', true)).join('');
  box('status-plate', 6, 42, 28, 20, 0, 0.8, 'lo', textLines + screws(6, 42, 28, 20, 0.8));
  return scene;
}
