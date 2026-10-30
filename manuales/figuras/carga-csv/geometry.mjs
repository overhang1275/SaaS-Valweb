import assert from 'node:assert/strict';
import * as k from './vendor/iso-kit.mjs';

const W = 840, H = 430;
const base = { x: -145, y: -60, w: 290, d: 120, r: 6 };
const P = k.fitProjection(k.boxCorners(base, -11, 82), W, H, { pad: 65, azimuth: 58, elevation: 28 });
const parts = [];
const line = (d, tone = 'faint', free) => k.lineSvg(d, { tone, free });
const dots = (plan, z) => k.dotsSvg(k.corners(plan, 2).map(([x, y]) => k.iso([x, y, z], P)), { size: 0.5 });

// Parts: 8 foot pieces, base, bed, 21 slats, 4 rails/stops, 8 mapping pieces,
// 7 scanner pieces, ruler, 4 lever pieces, 6 tray walls, label and 3 paper sheets.
function slab(id, x, y, w, d, z, h, tone = 'mid', inner = '', r = 1) {
  const plan = { x, y, w, d, r };
  const paths = k.slabOf(plan, z, h, P, 5, Math.min(0.6, h / 3));
  parts.push({ id, plan, z, h, svg: k.solidSvg(paths, { tone, lit: tone === 'lit', inner }) });
}

for (const [i, [x, y]] of k.corners(base, 20).entries()) {
  slab(`pad-${i}`, x - 7, y - 7, 14, 14, -11, 3, 'lo', '', 3);
  slab(`foot-${i}`, x - 5, y - 5, 10, 10, -8, 8, 'lo', '', 2);
}
slab('base', -145, -60, 290, 120, 0, 8, 'lo',
  line(k.planOutline(k.insetPlan(base, 4), 8, P)) + dots(k.insetPlan(base, 5), 8), 6);
slab('bed', -126, -20, 252, 40, 8, 8, 'lo');
for (let i = 0; i < 21; i++) slab(`slat-${i}`, -125 + i * 12, -19, 10, 38, 16, 3, 'mid', '', 0.5);
for (const y of [-24, 20]) slab(`rail-${y}`, -126, y, 252, 4, 8, 15, 'mid');
for (const x of [-132, 126]) slab(`stop-${x}`, x, -24, 6, 48, 8, 15, 'mid');
for (const y of [-36, 24]) {
  slab(`map-mount-${y}`, -65, y, 8, 12, 8, 15);
  slab(`map-cap-${y}`, -65, y, 8, 12, 23, 2, 'hi', dots({ x: -65, y, w: 8, d: 12 }, 25));
  slab(`map-neck-${y}`, -63, y + 4, 4, 4, 25, 3);
  slab(`map-knob-${y}`, -65, y + 2, 8, 8, 28, 3, 'hi');
}
for (const y of [-49, 29]) {
  slab(`scanner-foot-${y}`, -12, y, 24, 20, 8, 4, 'mid', dots({ x: -12, y, w: 24, d: 20 }, 12));
  slab(`scanner-post-${y}`, -8, y + 4, 16, 12, 12, 48, 'mid');
}
slab('scanner-bridge', -8, -45, 16, 90, 60, 8, 'mid');
slab('scanner-head', -4, -15, 8, 30, 48, 12, 'hi');
slab('scanner-cover', -6, -9, 12, 18, 68, 1, 'hi', dots({ x: -6, y: -9, w: 12, d: 18 }, 69));
const ticks = k.topTicks(-70, 40, 4, 5, -53, 9, [1.5, 3], P);
slab('ruler', -72, -53, 114, 4, 8, 1, 'lo', line(ticks.minor, 'lo') + line(ticks.major, 'mid'));
slab('lever-base', 65, 35, 22, 14, 8, 5, 'mid', dots({ x: 65, y: 35, w: 22, d: 14 }, 13));
slab('lever-pivot', 69, 39, 14, 6, 13, 8);
slab('lever-stem', 74, 40, 4, 4, 21, 17);
slab('lever-handle', 68, 37, 16, 10, 38, 5, 'hi');
for (const x of [-137, 88]) {
  for (const y of [-36, 32]) slab(`tray-wall-${x}-${y}`, x, y, 44, 4, 8, 18, 'mid');
  slab(`tray-end-${x}`, x === -137 ? -141 : 132, -36, 4, 72, 8, 18, 'mid');
}
const label = { x: -115, y: 43, w: 45, d: 10, r: 1 };
slab('label', label.x, label.y, label.w, label.d, 8, 1, 'mid',
  k.faceTextSvg(k.topMatrix([-92.5, 50], 9, P), 'VALWEB / CSV', { anchor: 'middle', size: 2.5, tone: 'mid' }));

const fixed = [...parts];
parts.length = 0;
for (let i = 0; i < 3; i++) {
  const x = -16 + i, y = -15 + i;
  const rules = [0, 1, 2].map(n => line(k.lineOnTop([x + 4, y + 6 + n * 5], [x + 23 - n * 2, y + 6 + n * 5], 19 + (i + 1) * 0.7, P), 'mid', true)).join('');
  slab(`sheet-${i}`, x, y, 30, 28, 19 + i * 0.7, 0.7, i === 2 ? 'lit' : 'hi', i === 2 ? rules : '', 0.8);
}
const paper = [...parts];

const bounds = part => [[part.plan.x, part.plan.x + part.plan.w], [part.plan.y, part.plan.y + part.plan.d], [part.z, part.z + part.h]];
function projected(part) {
  return k.boxCorners(part.plan, part.z, part.z + part.h).map(p => k.iso(p, P));
}
function screensOverlap(a, b) {
  // Separating axes of projected boxes: the three world directions, perpendicular in screen space.
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => {
    const [x, y] = k.axisVector(P, v);
    return [-y, x];
  });
  return axes.every(([x, y]) => {
    const aa = projected(a).map(p => p[0] * x + p[1] * y);
    const bb = projected(b).map(p => p[0] * x + p[1] * y);
    return Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb)) > 0.01;
  });
}

function ordered(all) {
  const edges = all.map(() => new Set());
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = bounds(all[i]), b = bounds(all[j]);
    assert(!a.every((range, axis) => Math.min(range[1], b[axis][1]) - Math.max(range[0], b[axis][0]) > 1e-6), `Intersección: ${all[i].id}/${all[j].id}`);
    if (!screensOverlap(all[i], all[j])) continue;
    for (let axis = 0; axis < 3; axis++) {
      if (a[axis][1] <= b[axis][0] + 1e-6) edges[j].add(i);
      if (b[axis][1] <= a[axis][0] + 1e-6) edges[i].add(j);
    }
  }
  const result = [], done = new Set();
  while (result.length < all.length) {
    const next = all.findIndex((_, i) => !done.has(i) && [...edges[i]].every(n => done.has(n)));
    assert(next >= 0, 'Orden de profundidad ambiguo');
    done.add(next); result.push(all[next]);
  }
  return result;
}

export function figure(position = -100, theme) {
  const sheets = paper.map(p => ({ ...p, plan: { ...p.plan, x: p.plan.x + position } }));
  const all = ordered([...fixed, ...sheets]);
  const halo = `<path class="iso-halo" d="${k.haloOf(base, -11, 0, P)}"/>`;
  const body = halo + all.map(p => p.id.startsWith('sheet')
    ? `<g data-piece="${p.id}" data-sheet transform="${k.translateAlong(P, [position, 0, 0])}">${p.svg}</g>`
    : `<g data-piece="${p.id}">${p.svg}</g>`).join('');
  return k.figureSvg({ width: W, height: H, label: 'Mesa de inspección CSV: bandeja de entrada, guías de mapeo, puesto de revisión y bandeja de publicación. La ficha avanza al revisar y publicar.', body, standalone: theme });
}

export const axis = k.axisVector(P, [1, 0, 0]);
export const pieceCount = fixed.length + paper.length;

export function motionOrders() {
  // shortcut: order is sampled at one world-unit intervals; refine if future parts create narrower occlusions.
  const orders = [], indices = [];
  for (let position = -100; position <= 100; position++) {
    const sheets = paper.map(p => ({ ...p, plan: { ...p.plan, x: p.plan.x + position } }));
    const ids = ordered([...fixed, ...sheets]).map(p => p.id);
    let index = orders.findIndex(order => order.join() === ids.join());
    if (index < 0) { index = orders.length; orders.push(ids); }
    indices.push(index);
  }
  return { orders, indices };
}

export function audit() {
  assert(pieceCount >= 40 && pieceCount <= 80);
  for (let position = -100; position <= 100; position += 1) figure(position);
  const all = [...fixed, ...paper.map(p => ({ ...p, plan: { ...p.plan, x: p.plan.x - 100 } }))];
  const supported = new Set(all.filter(p => p.z === -11));
  let previous = -1;
  while (previous !== supported.size) {
    previous = supported.size;
    for (const part of all) {
      const b = bounds(part);
      if ([...supported].some(other => {
        const ob = bounds(other);
        return [0, 1, 2].some(axis =>
          (Math.abs(b[axis][0] - ob[axis][1]) < 1e-6 || Math.abs(b[axis][1] - ob[axis][0]) < 1e-6)
          && [0, 1, 2].filter(n => n !== axis).every(n => Math.min(b[n][1], ob[n][1]) - Math.max(b[n][0], ob[n][0]) > 1e-6));
      })) supported.add(part);
    }
  }
  assert.equal(supported.size, all.length, 'Todas las piezas deben conectar físicamente con la base');
  return `${pieceCount} piezas; 201 posiciones sin intersecciones ni ciclos de profundidad; apoyos verificados`;
}
