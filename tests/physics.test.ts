import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAG_K, computeSpeed, toKmh, toMph } from '../src/core/physics';

describe('computeSpeed', () => {
  it('average speed is distance / time', () => {
    const r = computeSpeed({ distance: 18.9, time: 0.5, dragK: 0 });
    expect(r.average).toBeCloseTo(37.8);
    expect(r.release).toBeCloseTo(37.8);
  });

  it('release speed exceeds average because of drag', () => {
    const r = computeSpeed({ distance: 18.9, time: 0.5 });
    expect(r.release).toBeGreaterThan(r.average);
    expect(r.arrival).toBeLessThan(r.average);
  });

  it('inverts the drag model exactly', () => {
    const k = DEFAULT_DRAG_K;
    const v0 = 40;
    const D = 18.9;
    const t = Math.expm1(k * D) / (k * v0);
    expect(computeSpeed({ distance: D, time: t }).release).toBeCloseTo(v0, 6);
  });

  it('accounts for the bounce', () => {
    const plain = computeSpeed({ distance: 18.9, time: 0.5 });
    const bounced = computeSpeed({ distance: 18.9, time: 0.5, bounceAt: 12, bounceRetention: 0.85 });
    expect(bounced.release).toBeGreaterThan(plain.release);
  });

  it('rejects nonsense', () => {
    expect(() => computeSpeed({ distance: 0, time: 1 })).toThrow();
    expect(() => computeSpeed({ distance: 10, time: -1 })).toThrow();
  });

  it('converts units', () => {
    expect(toKmh(10)).toBeCloseTo(36);
    expect(toMph(10)).toBeCloseTo(22.369, 2);
  });
});
