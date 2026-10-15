/** Synthetic side-on delivery renderer for tests: a bowler blob, a ball with drag + bounce, sensor noise. */
import { DEFAULT_DRAG_K } from '../src/core/physics';

export interface SynthOptions {
  width?: number;
  height?: number;
  fps: number;
  /** Release speed, m/s. */
  v0: number;
  /** Metres from bowler's stumps where the ball bounces. */
  bounceAt?: number;
  bounceRetention?: number;
  dragK?: number;
  ballRadiusPx?: number;
  noise?: number;
  seed?: number;
  /** x px of bowler's stumps and batter's stumps. */
  x0?: number;
  x1?: number;
  groundY?: number;
  releaseHeight?: number;
}

export interface Synth {
  width: number;
  height: number;
  frames: { gray: Uint8Array; t: number }[];
  ppm: number;
  xAt: (s: number) => number;
  groundY: number;
  /** True time between ball passing s=a and s=b. */
  timeBetween: (a: number, b: number) => number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function synthDelivery(o: SynthOptions): Synth {
  const W = o.width ?? 640;
  const H = o.height ?? 240;
  const x0 = o.x0 ?? 40;
  const x1 = o.x1 ?? 600;
  const groundY = o.groundY ?? 200;
  const ppm = (x1 - x0) / 20.12;
  const xAt = (s: number) => x0 + s * ppm;
  const k = o.dragK ?? DEFAULT_DRAG_K;
  const c = o.bounceRetention ?? 0.9;
  const rand = rng(o.seed ?? 1);
  const noise = o.noise ?? 3;
  const r = o.ballRadiusPx ?? 2.2;
  const relS = 1.0;
  const relH = o.releaseHeight ?? 2.2;
  const bounceAt = o.bounceAt;

  // Integrate horizontal motion finely (time step 20 µs) to get s(t).
  const dtI = 2e-5;
  const ts: number[] = [0];
  const ss: number[] = [relS];
  let s = relS;
  let v = o.v0;
  let bounced = false;
  let t = 0;
  while (s < 21.5) {
    v -= k * v * v * dtI;
    s += v * dtI;
    t += dtI;
    if (bounceAt !== undefined && !bounced && s >= bounceAt) {
      v *= c;
      bounced = true;
    }
    ts.push(t);
    ss.push(s);
  }
  const sAt = (tt: number) => {
    if (tt <= 0) return relS;
    const i = Math.min(ss.length - 1, Math.floor(tt / dtI));
    return ss[i];
  };
  const tAtS = (sv: number) => {
    let lo = 0;
    let hi = ss.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ss[m] < sv) lo = m;
      else hi = m;
    }
    return ts[lo] + ((sv - ss[lo]) / (ss[hi] - ss[lo])) * (ts[hi] - ts[lo]);
  };
  const tb = bounceAt !== undefined ? tAtS(bounceAt) : tAtS(21.5);
  // Height: straight-line descent to the bounce, then rising after.
  const hAt = (tt: number) => {
    if (bounceAt === undefined) return relH - (relH - 0.5) * (tt / tb);
    if (tt < tb) return relH * (1 - tt / tb) + 0.036;
    return 0.036 + 2.0 * (tt - tb);
  };

  const tRelease = 0.4;
  const dtF = 1 / o.fps;
  const nFrames = Math.ceil((tRelease + tAtS(21) + 0.3) / dtF);
  const bg = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const y = Math.floor(i / W);
    bg[i] = (y > groundY ? 110 : 60) + rand() * 40;
  }
  const frames: Synth['frames'] = [];
  const sub = 6; // exposure sub-samples (motion blur)
  for (let f = 0; f < nFrames; f++) {
    const tf = f * dtF;
    const img = new Float32Array(bg);
    // Bowler: a body that runs in and stops near the crease, plus a swinging arm.
    const bx = xAt(0.2) + Math.min(0, (tf - tRelease) * 6 * ppm);
    for (let y = groundY - 1.8 * ppm; y < groundY; y++)
      for (let x = bx - 0.25 * ppm; x < bx + 0.25 * ppm; x++) {
        const xi = Math.round(x);
        const yi = Math.round(y);
        if (xi >= 0 && xi < W && yi >= 0 && yi < H) img[yi * W + xi] = 30;
      }
    const ang = (tf - tRelease) * 14;
    for (let q = 0; q < 0.8 * ppm; q++) {
      const ax = Math.round(bx + Math.sin(ang) * q);
      const ay = Math.round(groundY - 1.6 * ppm - Math.cos(ang) * q);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xi = ax + dx;
          const yi = ay + dy;
          if (xi >= 0 && xi < W && yi >= 0 && yi < H) img[yi * W + xi] = 40;
        }
    }
    // Ball after release, motion-blurred over the exposure.
    if (tf >= tRelease) {
      for (let k2 = 0; k2 < sub; k2++) {
        const tt = tf - tRelease + (k2 / sub) * dtF * 0.8;
        const bxp = xAt(sAt(tt));
        const byp = groundY - hAt(tt) * ppm;
        for (let y = Math.floor(byp - r - 1); y <= byp + r + 1; y++)
          for (let x = Math.floor(bxp - r - 1); x <= bxp + r + 1; x++) {
            if (x < 0 || x >= W || y < 0 || y >= H) continue;
            const d = Math.hypot(x - bxp, y - byp);
            const a = Math.max(0, Math.min(1, r + 0.5 - d));
            const i = y * W + x;
            img[i] += ((235 - img[i]) * a) / sub;
          }
      }
    }
    const gray = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = Math.max(0, Math.min(255, img[i] + (rand() - 0.5) * 2 * noise));
    frames.push({ gray, t: tf });
  }
  return {
    width: W,
    height: H,
    frames,
    ppm,
    xAt,
    groundY,
    timeBetween: (a, b) => tAtS(b) - tAtS(a),
  };
}
