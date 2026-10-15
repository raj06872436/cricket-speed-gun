import type { FrameBlobs } from './detector';
import { Analysis, AnalysisError, Calibration, ModelSettings, analyzeAuto } from './analysis';

export interface LiveOptions {
  /** Seconds of frames kept for analysis (a delivery takes ~0.4–1 s between the lines). */
  window?: number;
  /** Re-analyse after this many new frames. */
  checkEvery?: number;
  /** Wait this long after the last ball sighting before reporting, so the whole flight is seen. */
  settle?: number;
  /** Ignore anything slower than this (m/s): people walking, fielders, birds gliding. */
  minSpeed?: number;
  /** Deliveries must be at least this far apart in time (s). */
  minGap?: number;
}

/**
 * Real-time delivery detector: feed it per-frame motion blobs as they arrive from the
 * camera; it returns an analysis once per delivery, shortly after the ball has passed.
 */
export class LiveSpeedGun {
  private buf: FrameBlobs[] = [];
  private sinceCheck = 0;
  private lastReported = -Infinity;
  private readonly o: Required<LiveOptions>;

  constructor(
    private cal: Calibration,
    private model: ModelSettings = {},
    opts: LiveOptions = {},
  ) {
    this.o = { window: 2.5, checkEvery: 4, settle: 0.2, minSpeed: 13, minGap: 1.0, ...opts };
  }

  /** Frames currently buffered (for diagnostics). */
  get buffered(): number {
    return this.buf.length;
  }

  push(f: FrameBlobs): Analysis | null {
    this.buf.push(f);
    const cutoff = f.t - this.o.window;
    let drop = 0;
    while (drop < this.buf.length && this.buf[drop].t < cutoff) drop++;
    if (drop) this.buf.splice(0, drop);
    if (++this.sinceCheck < this.o.checkEvery) return null;
    this.sinceCheck = 0;
    // Cheap pre-check: a delivery needs small moving blobs in several recent frames.
    let withBlobs = 0;
    for (const b of this.buf) if (b.blobs.length) withBlobs++;
    if (withBlobs < 4) return null;

    let a: Analysis;
    try {
      a = analyzeAuto(this.buf, this.cal, this.model);
    } catch (e) {
      if (e instanceof AnalysisError) return null;
      throw e;
    }
    const last = a.track[a.track.length - 1];
    // Ball may still be in flight: wait until it has gone past.
    if (f.t - last.t < this.o.settle) return null;
    // Too old: the track began before frames we still hold, or we already reported it.
    if (a.tA - this.lastReported < this.o.minGap) {
      this.forget(last.t);
      return null;
    }
    if (a.speed.average < this.o.minSpeed || a.confidence === 'low') {
      this.forget(last.t);
      return null;
    }
    this.lastReported = a.tA;
    this.forget(last.t);
    return a;
  }

  /** Drops frames up to time t so the same ball is not found again. */
  private forget(t: number): void {
    this.buf = this.buf.filter((b) => b.t > t);
  }

  reset(): void {
    this.buf = [];
    this.sinceCheck = 0;
    this.lastReported = -Infinity;
  }
}
