import assert from 'node:assert/strict';
import * as k from './carga-csv/vendor/iso-kit.mjs';

const bounds = p => [[p.plan.x, p.plan.x + p.plan.w], [p.plan.y, p.plan.y + p.plan.d], [p.z, p.z + p.h]];

export function createScene({ label, base, points, pad = 65, azimuth = 54, elevation = 30 }) {
  const P = k.fitProjection(points || k.boxCorners(base, -12, 100), 840, 430, { pad, azimuth, elevation });
  const parts = [];
  const line = (d, tone = 'faint', free) => k.lineSvg(d, { tone, free });
  const screws = (plan, z) => k.dotsSvg(k.corners(plan, 2).map(([x, y]) => k.iso([x, y, z], P)), { size: 0.5 });
  function box(id, x, y, w, d, z, h, { tone = 'mid', r = 1, inner = '', moving = false } = {}) {
    assert(!parts.some(part => part.id === id), `ID repetido: ${id}`);
    const plan = { x, y, w, d, r };
    const svg = k.solidSvg(k.slabOf(plan, z, h, P, 5, Math.min(0.6, h / 3)), { tone, lit: tone === 'lit', inner });
    parts.push({ id, plan, z, h, moving, svg });
  }
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => { const [x, y] = k.axisVector(P, v); return [-y, x]; });
  function posed(position) {
    return parts.map(part => {
      const p = part.moving ? { ...part, plan: { ...part.plan, x: part.plan.x + position } } : part;
      const corners = k.boxCorners(p.plan, p.z, p.z + p.h).map(point => k.iso(point, P));
      return { ...p, bounds: bounds(p), screen: axes.map(([x, y]) => {
        const values = corners.map(point => point[0] * x + point[1] * y);
        return [Math.min(...values), Math.max(...values)];
      }) };
    });
  }
  function orderAt(all) {
    const edges = all.map(() => new Set());
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i].bounds, b = all[j].bounds;
      assert(!a.every((range, n) => Math.min(range[1], b[n][1]) - Math.max(range[0], b[n][0]) > 1e-6), `Intersección: ${all[i].id}/${all[j].id}`);
      const overlap = all[i].screen.every((range, n) => Math.min(range[1], all[j].screen[n][1]) - Math.max(range[0], all[j].screen[n][0]) > 0.01);
      if (!overlap) continue;
      for (let n = 0; n < 3; n++) {
        if (a[n][1] <= b[n][0] + 1e-6) edges[j].add(i);
        if (b[n][1] <= a[n][0] + 1e-6) edges[i].add(j);
      }
    }
    const done = new Set(), result = [];
    while (done.size < all.length) {
      const i = all.findIndex((_, n) => !done.has(n) && [...edges[n]].every(dep => done.has(dep)));
      assert(i >= 0, 'Ciclo de profundidad');
      done.add(i); result.push(all[i]);
    }
    return result;
  }
  function supported(all) {
    const ground = Math.min(...all.map(p => p.z));
    const connected = new Set(all.filter(p => p.z === ground));
    let previous = -1;
    while (previous !== connected.size) {
      previous = connected.size;
      for (const part of all) if (!connected.has(part) && [...connected].some(other => {
        const a = part.bounds, b = other.bounds;
        return [0, 1, 2].some(n => (Math.abs(a[n][0] - b[n][1]) < 1e-6 || Math.abs(a[n][1] - b[n][0]) < 1e-6)
          && [0, 1, 2].filter(axis => axis !== n).every(axis => Math.min(a[axis][1], b[axis][1]) - Math.max(a[axis][0], b[axis][0]) > 1e-6));
      })) connected.add(part);
    }
    assert.equal(connected.size, all.length, `Sin apoyo: ${all.filter(p => !connected.has(p)).map(p => p.id).join(', ')}`);
  }
  function svg(position = -100, theme = 'light') {
    const halo = `<path class="iso-halo" d="${k.haloOf(base, -12, 0, P)}"/>`;
    const body = halo + orderAt(posed(position)).map(p => `<g data-piece="${p.id}"${p.moving ? ` data-sheet transform="${k.translateAlong(P, [position, 0, 0])}"` : ''}>${p.svg}</g>`).join('');
    return k.figureSvg({ width: 840, height: 430, label, body, standalone: theme });
  }
  function finish() {
    const orders = [], indices = [];
    // shortcut: one world-unit depth samples, refine for future sub-unit occlusions.
    for (let position = -100; position <= 100; position++) {
      const ids = orderAt(posed(position)).map(part => part.id);
      let index = orders.findIndex(order => order.join() === ids.join());
      if (index < 0) { index = orders.length; orders.push(ids); }
      indices.push(index);
    }
    return { svg: svg(), axis: k.axisVector(P, [1, 0, 0]), orders, indices, pieceCount: parts.length };
  }
  function audit() {
    assert(parts.length >= 40 && parts.length <= 80, `${parts.length} piezas, se requieren 40–80`);
    for (let position = -100; position <= 100; position++) { const all = posed(position); orderAt(all); supported(all); }
    return `audit passed: ${parts.length} piezas; 201 poses; intersecciones, profundidad y apoyos: 0 fallos`;
  }
  return { k, P, box, line, screws, finish, svg, audit };
}
