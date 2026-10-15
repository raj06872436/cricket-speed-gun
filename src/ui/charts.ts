import { svg } from './dom';
import type { SpeedSample, BounceInfo } from '../core/analysis';
import { PITCH } from '../core/physics';

/** Speed (in display units) along the pitch: measured points plus the fitted model curve. */
export function speedChart(opts: {
  samples: SpeedSample[];
  model: (s: number) => number;
  posA: number;
  posB: number;
  bounceAt?: number;
  conv: (mps: number) => number;
  unit: string;
}): SVGElement {
  const W = 340;
  const H = 190;
  const m = { l: 40, r: 12, t: 22, b: 34 };
  const x0 = 0;
  const x1 = PITCH.batterStumps;
  const curve: { s: number; v: number }[] = [];
  for (let s = opts.posA; s <= opts.posB + 1e-6; s += (opts.posB - opts.posA) / 60) curve.push({ s, v: opts.conv(opts.model(s)) });
  const pts = opts.samples.map((p) => ({ s: p.s, v: opts.conv(p.v) })).filter((p) => p.s >= x0 && p.s <= x1 + 1);
  const vals = [...curve.map((c) => c.v), ...pts.map((p) => p.v)];
  let vMin = Math.min(...vals);
  let vMax = Math.max(...vals);
  const pad = Math.max(4, (vMax - vMin) * 0.25);
  vMin = Math.floor((vMin - pad) / 5) * 5;
  vMax = Math.ceil((vMax + pad) / 5) * 5;
  const X = (s: number) => m.l + ((s - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v: number) => m.t + (1 - (v - vMin) / (vMax - vMin)) * (H - m.t - m.b);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Speed along the pitch' });
  const step = vMax - vMin > 40 ? 20 : vMax - vMin > 20 ? 10 : 5;
  for (let v = vMin; v <= vMax; v += step) {
    root.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }));
    root.append(svg('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end', class: 'tick' }, String(v)));
  }
  for (let s = 0; s <= 20; s += 5) {
    root.append(svg('text', { x: X(s), y: H - m.b + 16, 'text-anchor': 'middle', class: 'tick' }, `${s}`));
  }
  root.append(svg('text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle', class: 'axis' }, 'metres from bowler’s stumps'));
  root.append(svg('text', { x: m.l - 6, y: 10, 'text-anchor': 'end', class: 'axis' }, opts.unit));
  if (opts.bounceAt !== undefined) {
    const bx = X(opts.bounceAt);
    root.append(svg('line', { x1: bx, x2: bx, y1: m.t, y2: H - m.b, class: 'bounce' }));
    root.append(svg('text', { x: bx + 4, y: m.t + 10, class: 'tick' }, 'bounce'));
  }
  root.append(
    svg('path', {
      d: curve.map((c, i) => `${i ? 'L' : 'M'}${X(c.s).toFixed(1)},${Y(c.v).toFixed(1)}`).join(''),
      class: 'model',
    }),
  );
  for (const p of pts) root.append(svg('circle', { cx: X(p.s), cy: Y(p.v), r: 3, class: 'pt' }));
  return root;
}

const ZONES: { from: number; to: number; name: string; cls: string }[] = [
  { from: 0, to: 2, name: 'Yorker', cls: 'z1' },
  { from: 2, to: 6, name: 'Full', cls: 'z2' },
  { from: 6, to: 8, name: 'Good', cls: 'z3' },
  { from: 8, to: 10, name: 'Back', cls: 'z4' },
  { from: 10, to: 20.12, name: 'Short', cls: 'z5' },
];

/** Top-down pitch map with length zones (measured from the batter's stumps) and the bounce point. */
export function pitchMap(bounce?: BounceInfo): SVGElement {
  const W = 340;
  const H = 92;
  const l = 14;
  const r = 14;
  const top = 18;
  const ph = 40;
  // Bowler on the left, batter on the right.
  const X = (fromBatter: number) => l + (1 - fromBatter / PITCH.batterStumps) * (W - l - r);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart pitch', role: 'img', 'aria-label': 'Pitch map' });
  for (const z of ZONES) {
    const x1 = X(z.to);
    const x2 = X(z.from);
    root.append(svg('rect', { x: x1, y: top, width: x2 - x1, height: ph, class: `zone ${z.cls}` }));
    root.append(svg('text', { x: (x1 + x2) / 2, y: top + ph + 14, 'text-anchor': 'middle', class: 'tick' }, z.name));
  }
  // Creases and stumps
  for (const fb of [PITCH.batterStumps, PITCH.batterStumps - PITCH.bowlerCrease]) {
    root.append(svg('line', { x1: X(fb), x2: X(fb), y1: top - 4, y2: top + ph + 4, class: 'crease' }));
  }
  for (const fb of [0, PITCH.bowlerCrease]) {
    root.append(svg('line', { x1: X(fb), x2: X(fb), y1: top - 4, y2: top + ph + 4, class: 'crease' }));
  }
  root.append(svg('text', { x: l, y: 11, class: 'tick' }, 'Bowler'));
  root.append(svg('text', { x: W - r, y: 11, 'text-anchor': 'end', class: 'tick' }, 'Batter'));
  if (bounce) {
    const bx = X(bounce.fromBatterStumps);
    root.append(svg('circle', { cx: bx, cy: top + ph / 2, r: 6, class: 'ball' }));
  }
  return root;
}
