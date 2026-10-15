import { describe, expect, it } from 'vitest';
import { MotionDetector, FrameBlobs } from '../src/core/detector';
import { analyzeAuto, analyzeManual, lengthName } from '../src/core/analysis';
import { verticalLine } from '../src/core/geometry';
import { PITCH } from '../src/core/physics';
import { synthDelivery, SynthOptions } from './synth';

function run(o: SynthOptions, posB: number = PITCH.batterStumps) {
  const sy = synthDelivery(o);
  const det = new MotionDetector({ width: sy.width, height: sy.height, maxArea: 600 });
  const frames: FrameBlobs[] = [];
  sy.frames.forEach((f, i) => {
    const r = det.push(f.gray, f.t, i);
    if (r) frames.push(r);
  });
  const cal = {
    lineA: verticalLine({ x: sy.xAt(PITCH.bowlerCrease), y: sy.groundY }),
    lineB: verticalLine({ x: sy.xAt(posB), y: sy.groundY }),
    posA: PITCH.bowlerCrease,
    posB,
  };
  return { sy, a: analyzeAuto(frames, cal, { bounceRetention: o.bounceRetention ?? 0.9 }) };
}

describe('auto pipeline on synthetic deliveries', () => {
  const cases: [string, SynthOptions][] = [
    ['fast, 240 fps, good length', { fps: 240, v0: 40, bounceAt: 13.5 }],
    ['fast, 120 fps, full', { fps: 120, v0: 42, bounceAt: 16 }],
    ['medium, 60 fps, short', { fps: 60, v0: 33, bounceAt: 10 }],
    ['spin, 60 fps', { fps: 60, v0: 23, bounceAt: 15 }],
    ['30 fps phone video', { fps: 30, v0: 38, bounceAt: 14, seed: 7 }],
  ];
  for (const [name, o] of cases) {
    it(name, () => {
      const { sy, a } = run(o);
      const trueTime = sy.timeBetween(PITCH.bowlerCrease, PITCH.batterStumps);
      const relErr = Math.abs(a.time - trueTime) / trueTime;
      // Timing within 2 % (30 fps) / 1 % (higher fps).
      expect(relErr).toBeLessThan(o.fps <= 30 ? 0.02 : 0.01);
      // Release speed within 4 % of the truth (model + measurement).
      expect(Math.abs(a.speed.release - o.v0) / o.v0).toBeLessThan(0.04);
      if (o.bounceAt !== undefined) {
        expect(a.bounce).toBeDefined();
        expect(Math.abs(a.bounce!.fromA + PITCH.bowlerCrease - o.bounceAt)).toBeLessThan(1.0);
      }
      expect(a.error).toBeGreaterThan(0);
      expect(a.samples.length).toBeGreaterThan(1);
    });
  }

  it('works when measuring to the batting crease', () => {
    const { sy, a } = run({ fps: 120, v0: 38, bounceAt: 14 }, PITCH.batterCrease);
    const trueTime = sy.timeBetween(PITCH.bowlerCrease, PITCH.batterCrease);
    expect(Math.abs(a.time - trueTime) / trueTime).toBeLessThan(0.01);
  });
});

describe('manual analysis', () => {
  it('computes speed from two frame times', () => {
    const a = analyzeManual(1.0, 1.5, 1 / 240, { posA: PITCH.bowlerCrease, posB: PITCH.batterStumps });
    expect(a.speed.average).toBeCloseTo(18.9 / 0.5);
    expect(a.confidence).toBe('high');
  });
  it('rejects reversed frames', () => {
    expect(() => analyzeManual(1.5, 1.0, 1 / 30, { posA: 1.22, posB: 20.12 })).toThrow();
  });
});

describe('lengthName', () => {
  it('classifies', () => {
    expect(lengthName(1)).toBe('Yorker');
    expect(lengthName(4)).toBe('Full');
    expect(lengthName(7)).toBe('Good length');
    expect(lengthName(9)).toBe('Back of a length');
    expect(lengthName(12)).toBe('Short');
  });
});

describe('colour channel', () => {
  it('finds a red ball whose brightness matches the background', () => {
    const W = 64;
    const H = 32;
    const N = W * H;
    const det = new MotionDetector({ width: W, height: H, channels: 2, minArea: 1 });
    const frame = (bx: number) => {
      const f = new Uint8Array(N * 2);
      f.fill(95, 0, N); // brightness: same for ball and grass
      f.fill(98, N); // colour plane: grass is greenish
      for (let y = 14; y < 18; y++) for (let x = bx; x < bx + 4; x++) f[N + y * W + x] = 213; // red ball
      return f;
    };
    det.push(frame(5), 0, 0);
    det.push(frame(25), 0.01, 1);
    const r = det.push(frame(45), 0.02, 2)!;
    expect(r.blobs.length).toBe(1);
    expect(r.blobs[0].x).toBeCloseTo(26.5, 0);
  });
});

describe('honesty', () => {
  it('refuses to guess when the ball is only seen near the end', async () => {
    const { analyzeAuto: run2 } = await import('../src/core/analysis');
    const A = verticalLine({ x: 100, y: 200 });
    const B = verticalLine({ x: 600, y: 200 });
    // Ball visible only over the last fifth of the flight.
    const frames: FrameBlobs[] = [];
    for (let i = 0; i < 6; i++) frames.push({ index: i, t: i / 30, blobs: [{ x: 500 + i * 40, y: 190, area: 9, w: 3, h: 3, strength: 3 }] });
    expect(() => run2(frames, { lineA: A, lineB: B, posA: 1.22, posB: 20.12 })).toThrow(/only visible for part/);
  });
});

describe('frameJitter', () => {
  it('is zero for a steady camera and grows with uneven frames', async () => {
    const { frameJitter } = await import('../src/core/analysis');
    expect(frameJitter([0, 0.01, 0.02, 0.03, 0.04])).toBeCloseTo(0);
    expect(frameJitter([0, 0.01, 0.05, 0.06, 0.1])).toBeGreaterThan(0.01);
  });
});
