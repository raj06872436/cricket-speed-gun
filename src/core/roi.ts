import { Gate, Line, Pt } from './geometry';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Analysis px per video px. */
  scale: number;
}

export interface DetectorParams {
  minArea: number;
  maxArea: number;
}

/** Target resolution: a cricket ball (72 mm) should cover ~3 analysis px. */
const TARGET_PX_PER_M = 42;
const MAX_W = 1000;
const MAX_AREA = 1000 * 440;

/**
 * Picks the part of the video to analyse (the pitch between and around the two
 * lines, up to ~3 m above the ground) and how much to downscale it.
 */
export function analysisRegion(A: Line, B: Line, distance: number, videoW: number, videoH: number): Region {
  const gate = new Gate(A, B);
  const ppm = gate.spanPx / distance;
  const pts: Pt[] = [A.a, A.b, B.a, B.b];
  const groundY = Math.max(A.a.y, B.a.y);
  const xs = pts.map((p) => p.x);
  let x0 = Math.min(...xs) - 1.2 * ppm;
  let x1 = Math.max(...xs) + 1.2 * ppm;
  let y0 = Math.min(Math.min(A.a.y, B.a.y) - 3.2 * ppm, ...pts.map((p) => p.y));
  let y1 = groundY + 0.8 * ppm;
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(videoW, Math.ceil(x1));
  y1 = Math.min(videoH, Math.ceil(y1));
  const w = Math.max(16, x1 - x0);
  const h = Math.max(16, y1 - y0);
  const scale = Math.min(1, TARGET_PX_PER_M / ppm, MAX_W / w, Math.sqrt(MAX_AREA / (w * h)));
  return { x: x0, y: y0, w, h, scale };
}

/** Maps a video-space line into analysis space. */
export function toRegion(l: Line, r: Region): Line {
  const f = (p: Pt) => ({ x: (p.x - r.x) * r.scale, y: (p.y - r.y) * r.scale });
  return { a: f(l.a), b: f(l.b) };
}

export function fromRegion(p: Pt, r: Region): Pt {
  return { x: p.x / r.scale + r.x, y: p.y / r.scale + r.y };
}

/** Blob size limits for the detector given the scene scale (analysis px per metre) and real frame interval. */
export function detectorParams(pxPerMeter: number, frameDt: number): DetectorParams {
  const ball = 0.072 * pxPerMeter;
  const streak = 45 * frameDt * pxPerMeter * 0.6;
  const maxArea = Math.round(Math.min(4000, Math.max(80, (ball + 6) * (ball + streak + 6) * 1.5)));
  return { minArea: ball < 2 ? 1 : 2, maxArea };
}
