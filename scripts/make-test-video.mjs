// Renders a synthetic side-on delivery with known speed to a video file for end-to-end testing.
// Usage: node scripts/make-test-video.mjs out.mp4 [fps=120] [releaseKmh=140] [bounceAt=14.5] [playbackFps]
// Env EXPOSURE sets shutter time in seconds (default 1/500, daylight).
// Pass playbackFps (e.g. 30 with fps=240) to make a slow-motion file that plays back slowly, like phone slo-mo.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [out = 'test-delivery.mp4', fpsArg = '120', kmhArg = '140', bounceArg = '14.5', playArg] = process.argv.slice(2);
const playFps = Number(playArg || fpsArg);
const exposure = Number(process.env.EXPOSURE || 1 / 500);
const fps = Number(fpsArg);
const v0 = Number(kmhArg) / 3.6;
const bounceAt = Number(bounceArg);
const W = 1280;
const H = 720;
const x0 = 110; // bowler's stumps (px)
const x1 = 1170; // batter's stumps (px)
const groundY = 520;
const ppm = (x1 - x0) / 20.12;
const X = (s) => x0 + s * ppm;
const k = (1.2 * 0.45 * Math.PI * 0.036 ** 2) / (2 * 0.1563);
const keep = 0.9;

// Integrate the flight.
const dt = 1e-5;
const T = [0];
const S = [1.0];
for (let s = 1.0, v = v0, t = 0, b = false; s < 21.5; ) {
  v -= k * v * v * dt;
  s += v * dt;
  t += dt;
  if (!b && s >= bounceAt) (v *= keep), (b = true);
  T.push(t);
  S.push(s);
}
const sAt = (t) => (t <= 0 ? 1.0 : S[Math.min(S.length - 1, Math.floor(t / dt))]);
const tAt = (s) => {
  let i = S.findIndex((x) => x >= s);
  return T[i];
};
const tb = tAt(bounceAt);
const hAt = (t) => (t < tb ? 2.1 * (1 - t / tb) + 0.036 : 0.036 + 2.2 * (t - tb) - 4.9 * (t - tb) ** 2);

const tRelease = 0.35;
const total = tRelease + tAt(21) + 0.25;
const n = Math.ceil(total * fps);

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const bg = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const tex = rand() * 18;
    let c;
    if (y < groundY - 260) c = [150 + tex, 185 + tex, 220]; // sky
    else if (y < groundY - 20 || y > groundY + 40) c = [55 + tex, 115 + tex, 50 + tex]; // grass
    else c = [190 + tex, 165 + tex, 115 + tex]; // pitch
    bg.set(c, i);
  }
const rect = (img, ax, ay, bx, by, c) => {
  for (let y = Math.max(0, Math.round(ay)); y < Math.min(H, Math.round(by)); y++)
    for (let x = Math.max(0, Math.round(ax)); x < Math.min(W, Math.round(bx)); x++) img.set(c, (y * W + x) * 3);
};
// Creases and stumps
for (const s of [0, 20.12]) rect(bg, X(s) - 3, groundY - 0.71 * ppm, X(s) + 3, groundY + 10, [245, 245, 240]);
for (const s of [1.22, 20.12 - 1.22]) rect(bg, X(s) - 2, groundY - 20, X(s) + 2, groundY + 40, [250, 250, 250]);

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(playFps), '-i', '-', '-c:v', out.endsWith('.webm') ? 'libvpx-vp9' : 'libx264', ...(out.endsWith('.webm') ? ['-b:v', '8M', '-deadline', 'realtime', '-cpu-used', '8'] : ['-crf', '16', '-preset', 'veryfast']), '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });

const r = 0.036 * ppm;
for (let f = 0; f < n; f++) {
  const t = f / fps;
  const img = new Uint8Array(bg);
  // Bowler: body and arm
  const bx = X(0.9) + Math.min(0, (t - tRelease) * 5 * ppm);
  rect(img, bx - 14, groundY - 1.8 * ppm, bx + 14, groundY, [30, 40, 120]);
  const ang = (t - tRelease) * 16;
  for (let q = 0; q < 0.75 * ppm; q += 2) {
    const ax = bx + Math.sin(ang) * q;
    const ay = groundY - 1.65 * ppm - Math.cos(ang) * q;
    rect(img, ax - 4, ay - 4, ax + 4, ay + 4, [200, 160, 130]);
  }
  // Batter standing still at the far end
  rect(img, X(19.6) - 14, groundY - 1.7 * ppm, X(19.6) + 14, groundY, [235, 235, 235]);
  if (t >= tRelease) {
    // Motion blur over the exposure time.
    const sub = Math.max(4, Math.ceil((exposure * v0 * ppm) / 1.5));
    const acc = new Map();
    for (let j = 0; j < sub; j++) {
      const tt = t - tRelease + (j / sub) * exposure;
      const cx = X(sAt(tt));
      const cy = groundY - hAt(tt) * ppm;
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
        for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
          const a = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x - cx, y - cy)));
          if (a > 0 && x >= 0 && x < W && y >= 0 && y < H) acc.set(y * W + x, (acc.get(y * W + x) ?? 0) + a / sub);
        }
    }
    for (const [p, a] of acc) {
      const i = p * 3;
      img[i] = img[i] + (185 - img[i]) * a;
      img[i + 1] = img[i + 1] + (25 - img[i + 1]) * a;
      img[i + 2] = img[i + 2] + (35 - img[i + 2]) * a;
    }
  }
  for (let i = 0; i < img.length; i++) img[i] = Math.max(0, Math.min(255, img[i] + (rand() - 0.5) * 6));
  if (!ff.stdin.write(img)) await new Promise((res) => ff.stdin.once('drain', res));
}
ff.stdin.end();
await new Promise((res) => ff.on('close', res));

const truth = {
  file: out,
  fps,
  slowMo: playFps !== fps ? fps : 0,
  width: W,
  height: H,
  releaseKmh: Number(kmhArg),
  bounceAt,
  bowlerCrease: { x: X(1.22), y: groundY },
  batterStumps: { x: X(20.12), y: groundY },
  creaseToStumpsSec: tAt(20.12) - tAt(1.22),
};
writeFileSync(out.replace(/\.\w+$/, '.json'), JSON.stringify(truth, null, 2));
console.log(JSON.stringify(truth));
