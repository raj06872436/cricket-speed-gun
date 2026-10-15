import { Gate, Pt } from './geometry';
import type { FrameBlobs } from './detector';

/**
 * Finds the ball's path among per-frame motion blobs and times it between two lines.
 */

export interface TrackPoint extends Pt {
  t: number;
  index: number;
  area: number;
}

export interface TrackerOptions {
  gate: Gate;
  /** Pixels per metre along the direction of travel (≈ gate.spanPx / distance). */
  pxPerMeter: number;
  /** Nominal real-time frame interval in seconds. */
  frameDt: number;
  minSpeed?: number; // m/s
  maxSpeed?: number; // m/s
  /** Max frames the ball may go undetected inside the track. */
  maxGap?: number;
}

interface Node {
  fb: number; // index into frames
  bi: number; // blob index
  p: TrackPoint;
  score: number;
  prev: Node | null;
  vel: number; // px per second along axis
  len: number;
}

/** Longest chain of detections moving consistently from line A towards line B. */
export function findTrack(frames: FrameBlobs[], opts: TrackerOptions): TrackPoint[] {
  const { gate, pxPerMeter } = opts;
  const vMin = (opts.minSpeed ?? 8) * pxPerMeter;
  const vMax = (opts.maxSpeed ?? 75) * pxPerMeter;
  const maxGap = opts.maxGap ?? 3;
  const spanA = gate.spanPx;
  const nodes: Node[][] = [];
  let best: Node | null = null;

  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi];
    const layer: Node[] = [];
    for (let bi = 0; bi < f.blobs.length; bi++) {
      const b = f.blobs[bi];
      const p: TrackPoint = { x: b.x, y: b.y, t: f.t, index: f.index, area: b.area };
      const fa = gate.fromA(p);
      // Only consider points from a little before line A to a little after line B.
      if (fa < -0.25 * spanA || gate.fromB(p) > 0.25 * spanA) continue;
      const node: Node = { fb: fi, bi, p, score: 1, prev: null, vel: 0, len: 1 };
      for (let g = 1; g <= maxGap + 1 && fi - g >= 0; g++) {
        const prevLayer = nodes[fi - g];
        if (!prevLayer) continue;
        for (const q of prevLayer) {
          const dt = p.t - q.p.t;
          if (dt <= 0) continue;
          const du = gate.along(p) - gate.along(q.p);
          const v = du / dt;
          if (v < vMin || v > vMax) continue;
          const dw = Math.abs(gate.across(p) - gate.across(q.p));
          // Vertical movement is much slower than horizontal for a delivered ball.
          if (dw > 0.6 * du + 4) continue;
          let s = q.score + 1 - 0.35 * (g - 1);
          if (q.prev) {
            const ratio = v / q.vel;
            if (ratio < 0.55 || ratio > 1.8) continue;
            s -= Math.abs(Math.log(ratio)) * 1.5;
          }
          if (s > node.score) {
            node.score = s;
            node.prev = q;
            node.vel = v;
            node.len = q.len + 1;
          }
        }
      }
      layer.push(node);
      if (node.len >= 3 && (!best || node.score > best.score)) best = node;
    }
    nodes[fi] = layer;
  }

  const out: TrackPoint[] = [];
  for (let n = best; n; n = n.prev) out.push(n.p);
  out.reverse();
  return out;
}

export type CrossMethod = 'interpolated' | 'extrapolated';

export interface Crossing {
  t: number;
  method: CrossMethod;
  /** How far beyond the observed track we had to extrapolate (px along the axis). */
  extrapolatedPx: number;
}

/** Linear fit y = a + b·x */
function linfit(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  const b = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  return { a: (sy - b * sx) / n, b };
}

/** Time at which signed distance `d(point)` crosses zero along the track. */
export function crossingTime(track: TrackPoint[], d: (p: Pt) => number): Crossing | null {
  if (track.length < 2) return null;
  const ds = track.map(d);
  for (let i = 1; i < track.length; i++) {
    if (ds[i - 1] < 0 && ds[i] >= 0) {
      const f = -ds[i - 1] / (ds[i] - ds[i - 1]);
      return { t: track[i - 1].t + f * (track[i].t - track[i - 1].t), method: 'interpolated', extrapolatedPx: 0 };
    }
  }
  // Not observed crossing: extrapolate from the nearest end of the track.
  const k = Math.min(5, track.length);
  const useStart = ds[0] >= 0;
  const seg = useStart ? track.slice(0, k) : track.slice(-k);
  const segD = useStart ? ds.slice(0, k) : ds.slice(-k);
  const fit = linfit(
    seg.map((p) => p.t),
    segD,
  );
  if (fit.b <= 0) return null;
  const t = -fit.a / fit.b;
  return { t, method: 'extrapolated', extrapolatedPx: Math.abs(useStart ? segD[0] : segD[segD.length - 1]) };
}

/**
 * Finds the bounce: in a side-on view the ball falls (image y grows) and then rises.
 * Returns the index of the lowest point if it is a clear V shape, else -1.
 */
export function findBounce(track: TrackPoint[], minRisePx: number): number {
  if (track.length < 5) return -1;
  let iMax = 0;
  for (let i = 1; i < track.length; i++) if (track[i].y > track[iMax].y) iMax = i;
  if (iMax < 2 || iMax > track.length - 3) return -1;
  const before = Math.min(...track.slice(0, iMax).map((p) => p.y));
  const after = Math.min(...track.slice(iMax + 1).map((p) => p.y));
  const yb = track[iMax].y;
  if (yb - before < minRisePx || yb - after < minRisePx) return -1;
  return iMax;
}
