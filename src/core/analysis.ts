import { Gate, Line } from './geometry';
import type { FrameBlobs } from './detector';
import { Crossing, TrackPoint, crossingTime, findBounce, findTrack } from './tracker';
import { PITCH, SpeedResult, computeSpeed, speedError } from './physics';

/** Where the user placed the two measurement lines. */
export interface Calibration {
  lineA: Line;
  lineB: Line;
  /** Real-world position of each line, metres from the bowler's stumps. */
  posA: number;
  posB: number;
}

export interface ModelSettings {
  dragK?: number;
  bounceRetention?: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export type LengthName = 'Yorker' | 'Full' | 'Good length' | 'Back of a length' | 'Short';

export interface BounceInfo {
  /** Metres from line A. */
  fromA: number;
  /** Metres in front of the batter's stumps. */
  fromBatterStumps: number;
  length: LengthName;
  t: number;
}

export interface SpeedSample {
  /** Metres from the bowler's stumps. */
  s: number;
  /** Measured speed in m/s. */
  v: number;
}

export interface Analysis {
  mode: 'auto' | 'manual';
  distance: number;
  time: number;
  tA: number;
  tB: number;
  methodA: Crossing['method'] | 'manual';
  methodB: Crossing['method'] | 'manual';
  speed: SpeedResult;
  /** 1-sigma error on the release speed (m/s). */
  error: number;
  confidence: Confidence;
  frameDt: number;
  bounce?: BounceInfo;
  track: TrackPoint[];
  samples: SpeedSample[];
}

export function lengthName(fromStumps: number): LengthName {
  if (fromStumps < 2) return 'Yorker';
  if (fromStumps < 6) return 'Full';
  if (fromStumps < 8) return 'Good length';
  if (fromStumps < 10) return 'Back of a length';
  return 'Short';
}

export function bounceInfo(fromA: number, posA: number, t: number): BounceInfo {
  const fromBatterStumps = PITCH.batterStumps - (posA + fromA);
  return { fromA, fromBatterStumps, length: lengthName(fromBatterStumps), t };
}

/** Median time between consecutive frames. */
export function medianDt(times: number[]): number {
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
  if (!d.length) return 1 / 30;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/** Standard deviation of the frame interval (s); 0 for a perfectly regular camera. */
export function frameJitter(times: number[]): number {
  if (times.length < 4) return 0;
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
  const m = d.reduce((a, b) => a + b, 0) / d.length;
  return Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length);
}

export class AnalysisError extends Error {}

/** Automatic analysis from per-frame motion blobs (coordinates in the same space as the calibration). */
export function analyzeAuto(frames: FrameBlobs[], cal: Calibration, model: ModelSettings = {}): Analysis {
  const distance = cal.posB - cal.posA;
  if (!(distance > 0)) throw new AnalysisError('Line 2 must be further down the pitch than line 1.');
  const gate = new Gate(cal.lineA, cal.lineB);
  const ppm = gate.spanPx / distance;
  const frameDt = medianDt(frames.map((f) => f.t));
  const track = findTrack(frames, { gate, pxPerMeter: ppm, frameDt });
  if (track.length < 3) {
    throw new AnalysisError("Couldn't find the ball. Try marking it by hand, or record with the whole pitch in view.");
  }
  const cA = crossingTime(track, (p) => gate.fromA(p));
  const cB = crossingTime(track, (p) => gate.fromB(p));
  if (!cA || !cB || !(cB.t > cA.t)) {
    throw new AnalysisError("The ball's path didn't cover both lines. Check the lines, or mark the ball by hand.");
  }
  const time = cB.t - cA.t;
  const extrap = Math.max(cA.extrapolatedPx, cB.extrapolatedPx) / gate.spanPx;
  if (extrap > 0.45) {
    throw new AnalysisError(
      'The ball was only visible for part of its flight, so an automatic reading would not be reliable. Mark it by hand, or film in brighter light or slow-motion.',
    );
  }

  const bi = findBounce(track, Math.max(2, 0.15 * ppm));
  let bounce: BounceInfo | undefined;
  if (bi >= 0) {
    const fromA = gate.frac(track[bi]) * distance;
    if (fromA > 0 && fromA < distance) bounce = bounceInfo(fromA, cal.posA, track[bi].t);
  }

  const speed = computeSpeed({ distance, time, bounceAt: bounce?.fromA, ...model });

  // Timing error per crossing: sub-frame interpolation is good to ~0.15 frame;
  // extrapolation adds error growing with how far we had to extend the track.
  const vPx = speed.average * ppm;
  const sig = (c: Crossing) =>
    c.method === 'interpolated' ? 0.15 * frameDt : 0.3 * frameDt + (0.15 * c.extrapolatedPx) / Math.max(vPx, 1);
  // Uneven frame timing (a busy phone, a camera that drops frames) makes timestamps less trustworthy.
  const jitter = frameJitter(frames.map((f) => f.t).filter((t) => t >= cA.t - 0.1 && t <= cB.t + 0.1));
  const sigma = Math.hypot(sig(cA), sig(cB), jitter);
  const error = speedError(speed.release, time, sigma);

  let confidence: Confidence = 'high';
  if (extrap > 0.35 || track.length < 4 || error / speed.release > 0.06) confidence = 'low';
  else if (extrap > 0.12 || error / speed.release > 0.03) confidence = 'medium';

  return {
    mode: 'auto',
    distance,
    time,
    tA: cA.t,
    tB: cB.t,
    methodA: cA.method,
    methodB: cB.method,
    speed,
    error,
    confidence,
    frameDt,
    bounce,
    track,
    samples: speedSamples(track, gate, cal),
  };
}

/** Manual analysis: the user picked the frames where the ball is at line A and line B. */
export function analyzeManual(
  tA: number,
  tB: number,
  frameDt: number,
  cal: Pick<Calibration, 'posA' | 'posB'>,
  model: ModelSettings = {},
  bounceFromA?: number,
): Analysis {
  const distance = cal.posB - cal.posA;
  const time = tB - tA;
  if (!(distance > 0)) throw new AnalysisError('Line 2 must be further down the pitch than line 1.');
  if (!(time > 0)) throw new AnalysisError('The "line 2" frame must come after the "line 1" frame.');
  const bounce =
    bounceFromA !== undefined && bounceFromA > 0 && bounceFromA < distance
      ? bounceInfo(bounceFromA, cal.posA, NaN)
      : undefined;
  const speed = computeSpeed({ distance, time, bounceAt: bounce?.fromA, ...model });
  // Picking whole frames: uniform error of ±half a frame at each end.
  const sigma = Math.hypot(frameDt / Math.sqrt(12), frameDt / Math.sqrt(12));
  const error = speedError(speed.release, time, sigma);
  const rel = error / speed.release;
  return {
    mode: 'manual',
    distance,
    time,
    tA,
    tB,
    methodA: 'manual',
    methodB: 'manual',
    speed,
    error,
    confidence: rel < 0.02 ? 'high' : rel < 0.05 ? 'medium' : 'low',
    frameDt,
    bounce,
    track: [],
    samples: [],
  };
}

/** Point-to-point speeds along the track, smoothed, as a function of position on the pitch. */
function speedSamples(track: TrackPoint[], gate: Gate, cal: Calibration): SpeedSample[] {
  const D = cal.posB - cal.posA;
  const pos = track.map((p) => cal.posA + gate.frac(p) * D);
  const raw: SpeedSample[] = [];
  for (let i = 1; i < track.length; i++) {
    const dt = track[i].t - track[i - 1].t;
    if (dt <= 0) continue;
    raw.push({ s: (pos[i] + pos[i - 1]) / 2, v: (pos[i] - pos[i - 1]) / dt });
  }
  // Keep the flight between the lines; drop points still in the bowler's hand and glitches.
  const inside = raw.filter((r) => r.s >= cal.posA - 0.2 && r.s <= cal.posB + 0.5);
  const sorted = inside.map((r) => r.v).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const clean = inside.filter((r) => Math.abs(r.v - med) < 0.3 * med);
  return clean.map((r, i) => {
    const w = clean.slice(Math.max(0, i - 1), i + 2);
    return { s: r.s, v: w.reduce((a, b) => a + b.v, 0) / w.length };
  });
}
