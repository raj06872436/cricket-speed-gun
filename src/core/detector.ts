/**
 * Streaming moving-object detector based on three-frame differencing.
 *
 * Push grayscale frames one at a time; each push returns the blobs found in the
 * previous frame (the middle of the three most recent). A pixel belongs to the
 * moving object in frame m when it differs from both frame m−1 and frame m+1,
 * which removes the "ghost" a plain two-frame difference leaves behind.
 */

export interface Blob {
  /** Centroid in analysis-frame pixels. */
  x: number;
  y: number;
  area: number;
  w: number;
  h: number;
  /** Mean absolute difference over the blob (contrast). */
  strength: number;
}

export interface FrameBlobs {
  index: number;
  /** Frame time in seconds (already scaled to real time). */
  t: number;
  blobs: Blob[];
}

export interface DetectorOptions {
  width: number;
  height: number;
  /** Smallest blob area in px. */
  minArea?: number;
  /** Largest blob area in px; bigger blobs are bodies, bats, shadows. */
  maxArea?: number;
  /** Lower bound on the difference threshold. */
  minThreshold?: number;
  /** Max blobs reported per frame. */
  maxBlobs?: number;
  /** Optional mask (1 = analyse) of length width·height. */
  mask?: Uint8Array;
  /**
   * Planes per frame, stored one after another (e.g. brightness then red-vs-green colour).
   * A pixel's difference is the largest over all planes, so a red ball on green grass
   * shows up even when its brightness matches the background.
   */
  channels?: number;
}

interface Slot {
  gray: Uint8Array;
  t: number;
  index: number;
}

export class MotionDetector {
  private readonly w: number;
  private readonly h: number;
  private readonly minArea: number;
  private readonly maxArea: number;
  private readonly minThreshold: number;
  private readonly maxBlobs: number;
  private readonly mask?: Uint8Array;
  private readonly channels: number;
  private slots: Slot[] = [];
  private readonly bin: Uint8Array;
  private readonly diff: Uint8Array;
  private readonly visited: Uint8Array;
  private readonly stack: Int32Array;

  constructor(opts: DetectorOptions) {
    this.w = opts.width;
    this.h = opts.height;
    this.minArea = opts.minArea ?? 2;
    this.maxArea = opts.maxArea ?? 400;
    this.minThreshold = opts.minThreshold ?? 14;
    this.maxBlobs = opts.maxBlobs ?? 40;
    this.mask = opts.mask;
    this.channels = opts.channels ?? 1;
    const n = this.w * this.h;
    this.bin = new Uint8Array(n);
    this.diff = new Uint8Array(n);
    this.visited = new Uint8Array(n);
    this.stack = new Int32Array(n);
  }

  /** Adds the next frame. Returns blobs for the previous frame once three frames are buffered. */
  push(gray: Uint8Array, t: number, index: number): FrameBlobs | null {
    if (gray.length !== this.w * this.h * this.channels) throw new Error('Frame size mismatch');
    this.slots.push({ gray, t, index });
    if (this.slots.length > 3) this.slots.shift();
    if (this.slots.length < 3) return null;
    const [p, m, n] = this.slots;
    return { index: m.index, t: m.t, blobs: this.detect(p.gray, m.gray, n.gray) };
  }

  reset(): void {
    this.slots = [];
  }

  private detect(p: Uint8Array, m: Uint8Array, n: Uint8Array): Blob[] {
    const N = this.w * this.h;
    const mask = this.mask;
    const diff = this.diff;
    // Noise estimate: mean of min(|m−p|, |m−n|) over the analysed area.
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < N; i++) {
      if (mask && !mask[i]) {
        diff[i] = 0;
        continue;
      }
      let d = 0;
      for (let c = 0, j = i; c < this.channels; c++, j += N) {
        const mv = m[j];
        const a = mv > p[j] ? mv - p[j] : p[j] - mv;
        const b = mv > n[j] ? mv - n[j] : n[j] - mv;
        const dc = a < b ? a : b;
        if (dc > d) d = dc;
      }
      diff[i] = d;
      sum += d;
      cnt++;
    }
    const noise = cnt ? sum / cnt : 0;
    const thr = Math.max(this.minThreshold, noise * 5 + 6);
    const bin = this.bin;
    for (let i = 0; i < N; i++) bin[i] = diff[i] >= thr ? 1 : 0;
    return this.components(thr);
  }

  /** Connected components with a 2-px neighbourhood so slightly fragmented streaks join up. */
  private components(thr: number): Blob[] {
    const { w, h, bin, visited, stack, diff } = this;
    visited.fill(0);
    const blobs: Blob[] = [];
    const R = 2;
    for (let start = 0; start < w * h; start++) {
      if (!bin[start] || visited[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      visited[start] = 1;
      let area = 0;
      let sx = 0;
      let sy = 0;
      let sw = 0;
      let sd = 0;
      let minX = w;
      let maxX = 0;
      let minY = h;
      let maxY = 0;
      let tooBig = false;
      while (sp > 0) {
        const i = stack[--sp];
        const x = i % w;
        const y = (i - x) / w;
        const wt = diff[i];
        area++;
        sx += x * wt;
        sy += y * wt;
        sw += wt;
        sd += wt;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (area > this.maxArea) tooBig = true;
        const y0 = Math.max(0, y - R);
        const y1 = Math.min(h - 1, y + R);
        const x0 = Math.max(0, x - R);
        const x1 = Math.min(w - 1, x + R);
        for (let yy = y0; yy <= y1; yy++) {
          const row = yy * w;
          for (let xx = x0; xx <= x1; xx++) {
            const j = row + xx;
            if (bin[j] && !visited[j]) {
              visited[j] = 1;
              stack[sp++] = j;
            }
          }
        }
      }
      if (tooBig || area < this.minArea) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      // Reject thin lines spanning a big box (e.g. a moving bat edge) — the ball is compact or a short streak.
      const fill = area / (bw * bh);
      if (fill < 0.15 && area > 12) continue;
      blobs.push({
        x: sx / sw,
        y: sy / sw,
        area,
        w: bw,
        h: bh,
        strength: sd / area / Math.max(1, thr),
      });
    }
    blobs.sort((a, b) => b.strength * Math.sqrt(b.area) - a.strength * Math.sqrt(a.area));
    return blobs.slice(0, this.maxBlobs);
  }
}
