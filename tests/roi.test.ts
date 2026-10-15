import { describe, expect, it } from 'vitest';
import { analysisRegion, detectorParams, fromRegion, toRegion } from '../src/core/roi';
import { verticalLine } from '../src/core/geometry';

describe('analysisRegion', () => {
  it('covers both lines and stays inside the video', () => {
    const A = verticalLine({ x: 200, y: 800 }, 300);
    const B = verticalLine({ x: 1700, y: 800 }, 300);
    const r = analysisRegion(A, B, 18.9, 1920, 1080);
    expect(r.x).toBeLessThan(200);
    expect(r.x + r.w).toBeGreaterThan(1700);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(1080);
    expect(r.w * r.scale).toBeLessThanOrEqual(1000.5);
  });
  it('round-trips coordinates', () => {
    const A = verticalLine({ x: 100, y: 300 });
    const B = verticalLine({ x: 600, y: 310 });
    const r = analysisRegion(A, B, 18.9, 640, 360);
    const p = toRegion(A, r).a;
    const q = fromRegion(p, r);
    expect(q.x).toBeCloseTo(100);
    expect(q.y).toBeCloseTo(300);
  });
});

describe('detectorParams', () => {
  it('allows bigger blobs at low frame rates', () => {
    expect(detectorParams(40, 1 / 30).maxArea).toBeGreaterThan(detectorParams(40, 1 / 240).maxArea);
  });
});
