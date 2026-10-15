// End-to-end check of live mode: Chromium's fake camera plays a looping synthetic delivery.
// Usage: npm run build && node scripts/e2e-live.mjs path/to/video.y4m [screenshotDir]
// (make the .y4m with: ffmpeg -i delivery.webm -pix_fmt yuv420p delivery.y4m)
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const [y4m, shots] = process.argv.slice(2);
const truth = JSON.parse(readFileSync(y4m.replace(/\.\w+$/, '.json'), 'utf8'));
if (shots) mkdirSync(shots, { recursive: true });

const port = 4181;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => String(d).includes(String(port)) && res());
  setTimeout(res, 8000);
});
const browser = await playwright.chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['camera'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e));
page.on('console', (m) => m.type() === 'info' && console.log('[page]', m.text()));
const shot = (n) => shots && page.screenshot({ path: `${shots}/${n}.png`, fullPage: true });
let ok = false;
try {
  await page.goto(`http://localhost:${port}/`);
  await page.getByRole('button', { name: /Live speed gun/ }).click();
  const canvas = page.locator('canvas.stage');
  await canvas.waitFor();
  await page.waitForFunction(() => document.querySelector('canvas.stage')?.width > 400, null, { timeout: 15000 });
  const box = await canvas.boundingBox();
  const tap = (p) => page.mouse.click(box.x + (p.x / truth.width) * box.width, box.y + (p.y / truth.height) * box.height);
  await tap(truth.bowlerCrease);
  await tap(truth.batterStumps);
  await shot('live-1-setup');
  await page.getByRole('button', { name: 'Start live speed gun' }).click();
  await page.locator('.live-num').waitFor({ timeout: 30000 });
  const first = Number(await page.locator('.live-num').innerText());
  await shot('live-2-first');
  // Wait for at least two more deliveries (the clip loops).
  await page.waitForFunction(() => document.querySelectorAll('.live-list li').length >= 3, null, { timeout: 30000 });
  await page.locator('summary', { hasText: 'Detailed analysis' }).click();
  await shot('live-3-more');
  const speeds = [first, ...(await page.locator('.live-list li .h-speed').allInnerTexts()).map((t) => parseFloat(t))];
  console.log('Live speeds:', speeds.join(', '), 'truth', truth.releaseKmh);
  ok = speeds.every((v) => Math.abs(v - truth.releaseKmh) / truth.releaseKmh < 0.04);
} catch (e) {
  console.error(e);
  await shot('live-error');
} finally {
  await browser.close();
  server.kill();
}
console.log(ok ? 'LIVE E2E PASS' : 'LIVE E2E FAIL');
process.exit(ok ? 0 : 1);
