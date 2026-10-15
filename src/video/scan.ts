/**
 * Decodes every frame of a video (or as many as the browser presents) with its
 * exact presentation timestamp, and hands a grayscale crop of each to a callback.
 */

export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Output scale (analysis px per video px). */
  scale: number;
}

export interface ScanResult {
  /** Media timestamps (s) of every frame seen, in order. */
  times: number[];
  /** Frames the browser presented without us seeing them. */
  dropped: number;
}

/** Average frame rate over a scan (robust to millisecond-rounded timestamps). */
export function scanFps(times: number[]): number | undefined {
  if (times.length < 6) return undefined;
  return (times.length - 1) / (times[times.length - 1] - times[0]);
}

/** Frames are handed over as two planes: brightness, then red-vs-green colour. */
export const SCAN_CHANNELS = 2;

export type FrameHandler = (gray: Uint8Array, mediaTime: number, index: number) => void;

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => number;
};

export function supportsFrameCallback(video: HTMLVideoElement): boolean {
  return typeof (video as RVFCVideo).requestVideoFrameCallback === 'function';
}

function makeGrabber(video: HTMLVideoElement, crop: Crop) {
  const ow = Math.max(8, Math.round(crop.w * crop.scale));
  const oh = Math.max(8, Math.round(crop.h * crop.scale));
  const canvas = document.createElement('canvas');
  canvas.width = ow;
  canvas.height = oh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return {
    width: ow,
    height: oh,
    grab(): Uint8Array {
      ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, ow, oh);
      const d = ctx.getImageData(0, 0, ow, oh).data;
      const n = ow * oh;
      // Plane 1: brightness. Plane 2: red-vs-green colour (a red ball on grass).
      const g = new Uint8Array(n * 2);
      for (let i = 0, j = 0; j < n; i += 4, j++) {
        const r = d[i];
        const gr = d[i + 1];
        g[j] = (r * 77 + gr * 150 + d[i + 2] * 29) >> 8;
        g[n + j] = (r - gr + 256) >> 1;
      }
      return g;
    },
  };
}

export function cropSize(crop: Crop): { width: number; height: number } {
  return { width: Math.max(8, Math.round(crop.w * crop.scale)), height: Math.max(8, Math.round(crop.h * crop.scale)) };
}

/**
 * Plays the video slowly and captures every presented frame via requestVideoFrameCallback.
 * Playback speed adapts to how long each frame takes to process, so the browser never has
 * to skip frames (skipped frames also mean the drawn image may not match its timestamp).
 */
async function scanWithFrameCallback(
  video: RVFCVideo,
  crop: Crop,
  onFrame: FrameHandler,
  onProgress: (f: number) => void,
  fps: number,
  slowdown: number,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const g = makeGrabber(video, crop);
  const times: number[] = [];
  let dropped = 0;
  let lastPresented = -1;
  // Present at most ~24 frames per real second, and leave headroom over processing time.
  const wantedRate = (procMs: number) => Math.min(1, 1 / (fps * Math.max(1 / 24, (procMs * 3) / 1000)) / slowdown);
  // Browsers refuse rates below 1/16; below that we pause while processing each frame instead.
  const MIN_RATE = 0.0625;
  const rateFor = (procMs: number) => Math.max(MIN_RATE, wantedRate(procMs));
  let pauseEach = wantedRate(8) < MIN_RATE;
  let procMs = 8;
  let rate = rateFor(procMs);
  video.pause();
  video.muted = true;
  video.currentTime = 0;
  await waitSeek(video);
  video.playbackRate = rate;
  return new Promise<ScanResult>((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.pause();
      video.playbackRate = 1;
      video.removeEventListener('ended', finish);
      resolve({ times, dropped });
    };
    const onAbort = () => {
      done = true;
      video.pause();
      video.playbackRate = 1;
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const cb = (_now: number, meta: { mediaTime: number; presentedFrames: number }) => {
      if (done) return;
      if (lastPresented >= 0 && meta.presentedFrames > lastPresented + 1) dropped += meta.presentedFrames - lastPresented - 1;
      lastPresented = meta.presentedFrames;
      const t = meta.mediaTime;
      if (!times.length || t > times[times.length - 1]) {
        const t0 = performance.now();
        if (pauseEach) video.pause();
        times.push(t);
        try {
          onFrame(g.grab(), t, times.length - 1);
        } catch (e) {
          done = true;
          video.pause();
          reject(e);
          return;
        }
        procMs = procMs * 0.8 + (performance.now() - t0) * 0.2;
        pauseEach = pauseEach || wantedRate(procMs) < MIN_RATE;
        const want = rateFor(procMs);
        if (Math.abs(want - rate) / rate > 0.15) {
          rate = want;
          video.playbackRate = rate;
        }
        if (pauseEach && !video.ended) void video.play().catch(() => {});
      }
      if (isFinite(video.duration) && video.duration > 0) onProgress(Math.min(1, t / video.duration));
      video.requestVideoFrameCallback!(cb);
    };
    video.requestVideoFrameCallback!(cb);
    video.addEventListener('ended', finish);
    video.play().catch(reject);
  });
}

/** Fallback: seek frame by frame at an assumed frame rate. */
async function scanBySeeking(
  video: HTMLVideoElement,
  crop: Crop,
  onFrame: FrameHandler,
  onProgress: (f: number) => void,
  fps: number,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const g = makeGrabber(video, crop);
  const times: number[] = [];
  const n = Math.floor(video.duration * fps);
  video.pause();
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    video.currentTime = (i + 0.5) / fps;
    await waitSeek(video);
    times.push(i / fps);
    onFrame(g.grab(), i / fps, i);
    onProgress(i / n);
  }
  return { times, dropped: 0 };
}

export function waitSeek(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (!video.seeking && video.readyState >= 2) {
      // A seek may still be pending this tick; give it a chance to start.
      requestAnimationFrame(() => (video.seeking ? video.addEventListener('seeked', () => resolve(), { once: true }) : resolve()));
      return;
    }
    video.addEventListener('seeked', () => resolve(), { once: true });
  });
}

export interface ScanOptions {
  crop: Crop;
  onFrame: FrameHandler;
  onProgress?: (f: number) => void;
  /** Rough nominal fps of the file, used for playback speed and for the seek fallback. */
  nominalFps?: number;
  /** Extra slowdown factor (≥ 1) for a retry after frames were dropped. */
  slowdown?: number;
  signal?: AbortSignal;
}

export async function scanVideo(video: HTMLVideoElement, o: ScanOptions): Promise<ScanResult> {
  const fps = o.nominalFps ?? 30;
  const progress = o.onProgress ?? (() => {});
  if (supportsFrameCallback(video)) {
    return scanWithFrameCallback(video as RVFCVideo, o.crop, o.onFrame, progress, fps, o.slowdown ?? 1, o.signal);
  }
  return scanBySeeking(video, o.crop, o.onFrame, progress, fps, o.signal);
}

/**
 * Quick estimate of a video's frame rate by playing the first ~0.5 s with frame callbacks.
 * Returns undefined if the browser cannot tell us.
 */
export async function probeFps(video: RVFCVideo): Promise<number | undefined> {
  if (!supportsFrameCallback(video)) return undefined;
  video.muted = true;
  video.currentTime = 0;
  await waitSeek(video);
  video.playbackRate = 0.25;
  const times: number[] = [];
  await new Promise<void>((resolve) => {
    const stop = () => {
      video.pause();
      resolve();
    };
    const timer = setTimeout(stop, 2500);
    const cb = (_n: number, meta: { mediaTime: number }) => {
      times.push(meta.mediaTime);
      if (times.length >= 16) {
        clearTimeout(timer);
        stop();
      } else video.requestVideoFrameCallback!(cb);
    };
    video.requestVideoFrameCallback!(cb);
    video.addEventListener('ended', () => {
      clearTimeout(timer);
      stop();
    }, { once: true });
    video.play().catch(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  video.playbackRate = 1;
  const d: number[] = [];
  for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) d.push(times[i] - times[i - 1]);
  if (d.length < 3) return undefined;
  d.sort((a, b) => a - b);
  return 1 / d[Math.floor(d.length / 2)];
}

/** MediaRecorder WebM files often report duration = Infinity; force the browser to compute it. */
export async function fixDuration(video: HTMLVideoElement): Promise<void> {
  if (isFinite(video.duration)) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('durationchange', check);
      resolve();
    };
    const check = () => {
      if (isFinite(video.duration)) {
        video.currentTime = 0;
        done();
      }
    };
    video.addEventListener('durationchange', check);
    video.currentTime = 1e101;
    setTimeout(done, 3000);
  });
  await waitSeek(video);
}
