// End-to-end check: drives the built app in Chromium with a synthetic delivery of known speed.
// Usage: npm run build && node scripts/e2e.mjs path/to/video.mp4 [screenshotDir]
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

const [videoPath, shots] = process.argv.slice(2);
if (!videoPath) throw new Error('usage: node scripts/e2e.mjs video.mp4 [screenshotDir]');
const truth = JSON.parse(readFileSync(videoPath.replace(/\.\w+$/, '.json'), 'utf8'));
if (shots) mkdirSync(shots, { recursive: true });

const port = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
await new Promise((res) => {
  server.stdout.on('data', (d) => String(d).includes(String(port)) && res());
  setTimeout(res, 8000);
});

const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGE ERROR', e));
page.on('console', (m) => m.type() === 'info' && console.log('[page]', m.text()));
const shot = (name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

let ok = false;
try {
  await page.goto(`http://localhost:${port}/`);
  await shot('1-home');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Use a video/ }).click()]);
  await chooser.setFiles(videoPath);
  const canvas = page.locator('canvas.stage');
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const box = await canvas.boundingBox();
  const tap = async (p) => {
    const x = box.x + (p.x / truth.width) * box.width;
    const y = box.y + (p.y / truth.height) * box.height;
    await page.mouse.click(x, y);
  };
  await tap(truth.bowlerCrease);
  await tap(truth.batterStumps);
  await shot('2-setup');
  if (truth.slowMo) await page.getByRole('radio', { name: `Slow-mo ${truth.slowMo}` }).click();
  await page.getByRole('button', { name: 'Measure speed' }).click();
  await page.locator('.speed-num, h2:has-text("Ball not found")').first().waitFor({ timeout: 120000 });
  await shot('3-result');
  if (await page.locator('h2:has-text("Ball not found")').count()) throw new Error('Ball not found');
  const kmh = Number(await page.locator('.speed-num').innerText());
  await page.locator('summary', { hasText: 'Detailed analysis' }).click();
  await page.waitForTimeout(1500);
  await shot('4-details');
  const stats = await page.locator('dl.stats').innerText();
  console.log(stats.replace(/\n/g, ' | '));
  const err = Math.abs(kmh - truth.releaseKmh) / truth.releaseKmh;
  console.log(`Measured ${kmh} km/h, truth ${truth.releaseKmh} km/h (error ${(err * 100).toFixed(1)}%)`);
  ok = err < 0.03;

  // Manual mode should also work.
  await page.getByRole('button', { name: 'Check / fix by hand' }).click();
  await page.getByRole('button', { name: 'Calculate speed' }).waitFor();
  await page.waitForTimeout(800);
  await shot('5-manual');
  await page.getByRole('button', { name: 'Calculate speed' }).click();
  await page.locator('.speed-num').waitFor();
  console.log(`Manual (pre-filled from auto): ${await page.locator('.speed-num').innerText()} km/h`);

  await page.getByRole('button', { name: 'Measure another ball' }).click();
  await shot('6-home-after');
  await page.getByRole('button', { name: 'History' }).click();
  await shot('7-history');
} catch (e) {
  console.error(e);
  await shot('error');
} finally {
  await browser.close();
  server.kill();
}
console.log(ok ? 'E2E PASS' : 'E2E FAIL');
process.exit(ok ? 0 : 1);
