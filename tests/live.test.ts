import { describe, expect, it } from 'vitest';
import { MotionDetector, FrameBlobs } from '../src/core/detector';
import { LiveSpeedGun } from '../src/core/live';
import { verticalLine } from '../src/core/geometry';
import { PITCH } from '../src/core/physics';
import { synthDelivery } from './synth';

describe('LiveSpeedGun', () => {
  it('reports each delivery once, with the right speed, and nothing while idle', () => {
    const fps = 60;
    const balls = [
      synthDelivery({ fps, v0: 38, bounceAt: 14, seed: 3 }),
      synthDelivery({ fps, v0: 31, bounceAt: 12, seed: 4 }),
    ];
    const sy = balls[0];
    // Idle frames: the static background of the first clip's first frame, with fresh noise.
    const idle = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const g = new Uint8Array(sy.frames[0].gray);
        for (let k = 0; k < g.length; k += 7) g[k] = Math.max(0, Math.min(255, g[k] + ((i * 31 + k) % 7) - 3));
        return g;
      });
    const stream: Uint8Array[] = [...idle(90), ...balls[0].frames.map((f) => f.gray), ...idle(90), ...balls[1].frames.map((f) => f.gray), ...idle(90)];

    const det = new MotionDetector({ width: sy.width, height: sy.height, maxArea: 600 });
    const gun = new LiveSpeedGun({
      lineA: verticalLine({ x: sy.xAt(PITCH.bowlerCrease), y: sy.groundY }),
      lineB: verticalLine({ x: sy.xAt(PITCH.batterStumps), y: sy.groundY }),
      posA: PITCH.bowlerCrease,
      posB: PITCH.batterStumps,
    });
    const found: number[] = [];
    stream.forEach((g, i) => {
      const fb: FrameBlobs | null = det.push(g, 100 + i / fps, i);
      if (!fb) return;
      const a = gun.push(fb);
      if (a) found.push(a.speed.release);
    });
    expect(found.length).toBe(2);
    expect(Math.abs(found[0] - 38) / 38).toBeLessThan(0.05);
    expect(Math.abs(found[1] - 31) / 31).toBeLessThan(0.05);
  });
});
