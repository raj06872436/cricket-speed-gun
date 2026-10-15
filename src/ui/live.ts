import { h, chips, toast } from './dom';
import { Stage } from './stage';
import { store } from './store';
import { conv, fmtSpeed, fmtDate, unitLabel } from './format';
import { confidenceText, detailsContent, model, saveDelivery } from './details';
import type { Nav } from './flow';
import { MotionDetector } from '../core/detector';
import { Gate, Line } from '../core/geometry';
import { LiveSpeedGun } from '../core/live';
import type { Analysis } from '../core/analysis';
import { analysisRegion, detectorParams, fromRegion, toRegion, Region } from '../core/roi';
import { PITCH } from '../core/physics';
import { openCamera, CameraSession } from '../video/record';
import { SCAN_CHANNELS, makeGrabber } from '../video/scan';

interface FrameMeta {
  mediaTime: number;
  captureTime?: number;
}
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number;
};

interface LiveBall {
  a: Analysis;
  id: string;
  date: number;
  fps: number;
}

/**
 * Live speed gun: watches the camera continuously and shows the speed of every
 * delivery as soon as the ball has passed, without recording anything.
 */
export async function liveScreen(nav: Nav): Promise<void> {
  const preview = h('video', { playsinline: true, muted: true, autoplay: true }) as RVFCVideo;
  const holder = h('div.video-holder', { 'aria-hidden': 'true' }, preview);
  document.body.append(holder);
  const stage = new Stage(preview);
  stage.editable = true;
  stage.zoomable = false;
  let posA: number = PITCH.bowlerCrease;
  let posB: number = PITCH.batterStumps;

  let cam: CameraSession | null = null;
  let stopped = false;
  let running = false;
  let wakeLock: { release(): Promise<void> } | null = null;
  let audio: AudioContext | null = null;
  let sound = true;
  const balls: LiveBall[] = [];

  // Measurement state, rebuilt whenever the lines change.
  let region: Region | null = null;
  let detector: MotionDetector | null = null;
  let gun: LiveSpeedGun | null = null;
  let grab: (() => Uint8Array) | null = null;
  let frameIndex = 0;
  let useCapture: boolean | null = null;
  let lastT = 0;
  let fpsEma = 0;
  let shaky = 0;
  let trackTimer = 0;

  const status = h('div.live-status', { 'aria-live': 'polite' }, 'Starting camera…');
  const instruction = h('div.instruction', { 'aria-live': 'polite' });
  const startBtn = h('button.primary.big', { type: 'button' }, 'Start live speed gun') as HTMLButtonElement;
  const lastCard = h('section.card.live-last', { 'aria-live': 'polite' });
  const listEl = h('ul.history.live-list');
  const detailsEl = h('details.more.details', {});
  const controls = h('div.actions');

  const names = () => {
    stage.lineNames = [
      posA === PITCH.bowlerStumps ? 'Bowler’s stumps' : 'Bowler’s crease',
      posB === PITCH.batterCrease ? 'Batter’s crease' : 'Batter’s stumps',
    ];
  };
  names();

  const updateSetup = () => {
    const n = stage.nextLine;
    instruction.innerHTML =
      n === 0
        ? '<span class="badge y">1</span> Put the phone somewhere <b>steady</b>, side-on. Then tap the <b>bowler’s crease</b> in the middle of the pitch.'
        : n === 1
          ? '<span class="badge b">2</span> Now tap the bottom of the <b>batter’s stumps</b>.'
          : '<span class="badge ok">✓</span> Lines set. Drag the circles to fine-tune, then press <b>Start</b>.';
    startBtn.disabled = n !== -1;
  };
  stage.onChange = updateSetup;

  const saved = store.lines();
  const reuse = h('button.ghost.small', { type: 'button', hidden: true }, 'Use my lines from last time') as HTMLButtonElement;
  reuse.addEventListener('click', () => {
    if (!saved) return;
    stage.setLines([saved.lineA, saved.lineB]);
    posA = saved.posA;
    posB = saved.posB;
    names();
    updateSetup();
  });
  const reset = h('button.ghost.small', { type: 'button', onclick: () => (stage.setLines(null), updateSetup()) }, 'Reset lines');

  const soundChips = chips(
    [
      { value: 'on', label: 'Beep on' },
      { value: 'off', label: 'Silent' },
    ],
    'on',
    (v) => (sound = v === 'on'),
    'Sound',
  );

  function build(lines: [Line, Line]) {
    const D = posB - posA;
    region = analysisRegion(lines[0], lines[1], D, preview.videoWidth, preview.videoHeight, { pxPerMeter: 30, maxWidth: 720, maxArea: 720 * 300 });
    const gate = new Gate(toRegion(lines[0], region), toRegion(lines[1], region));
    const fps = fpsEma || cam?.fps || 30;
    const p = detectorParams(gate.spanPx / D, 1 / fps);
    const width = Math.max(8, Math.round(region.w * region.scale));
    const height = Math.max(8, Math.round(region.h * region.scale));
    detector = new MotionDetector({ width, height, channels: SCAN_CHANNELS, ...p });
    gun = new LiveSpeedGun({ lineA: toRegion(lines[0], region), lineB: toRegion(lines[1], region), posA, posB }, model());
    grab = makeGrabber(preview, region).grab;
  }

  function beep() {
    try {
      navigator.vibrate?.(90);
    } catch {
      /* not supported */
    }
    if (!sound || !audio) return;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.2);
  }

  function renderLast() {
    const s = store.settings();
    const u = unitLabel(s.unit);
    const b = balls[0];
    if (!b) {
      lastCard.replaceChildren(h('p.live-wait', {}, 'Waiting for the first ball…'), h('p.hint', {}, 'Bowl normally. The speed appears here about half a second after the ball passes the batter.'));
      detailsEl.hidden = true;
      return;
    }
    const val = s.headline === 'release' ? b.a.speed.release : b.a.speed.average;
    lastCard.replaceChildren(
      h('div.speed-num.live-num', {}, fmtSpeed(val, s.unit)),
      h('div.speed-unit', {}, u),
      h('div.speed-label', {}, [s.headline === 'release' ? 'Out of the hand' : 'Average speed', b.a.bounce?.length].filter(Boolean).join(' · ')),
      h(`div.conf.${b.a.confidence}`, {}, confidenceText(b.a, u, conv(s.unit))),
    );
    lastCard.classList.remove('flash');
    void lastCard.offsetWidth;
    lastCard.classList.add('flash');
    detailsEl.hidden = false;
    detailsEl.replaceChildren(h('summary', {}, 'Detailed analysis of this ball'), ...detailsContent(b.a, { posA, posB, fps: b.fps, live: true }));
  }

  function renderList() {
    const s = store.settings();
    const u = unitLabel(s.unit);
    if (balls.length < 2) {
      listEl.replaceChildren();
      return;
    }
    const max = Math.max(...balls.map((b) => b.a.speed.release));
    const avg = balls.reduce((x, b) => x + b.a.speed.release, 0) / balls.length;
    listEl.replaceChildren(
      h('li.live-sum', {}, h('span', {}, `This session: ${balls.length} balls`), h('span', {}, `fastest ${fmtSpeed(max, s.unit)} · avg ${fmtSpeed(avg, s.unit)} ${u}`)),
      ...balls.slice(1, 12).map((b) =>
        h(
          'li',
          {},
          h('div.h-speed', {}, fmtSpeed(b.a.speed.release, s.unit), h('small', {}, u)),
          h('div.h-meta', {}, h('strong', {}, b.a.bounce?.length ?? 'Delivery'), h('small', {}, fmtDate(b.date))),
          h('span'),
        ),
      ),
    );
  }

  function onDelivery(a: Analysis) {
    // Track back to video coordinates for drawing.
    a.track = a.track.map((p) => ({ ...p, ...fromRegion(p, region!) }));
    const fps = Math.round(fpsEma) || cam?.fps || 30;
    const id = saveDelivery(a, fps, 'auto');
    balls.unshift({ a, id, date: Date.now(), fps });
    stage.track = a.track;
    clearTimeout(trackTimer);
    trackTimer = window.setTimeout(() => (stage.track = []), 3000);
    beep();
    renderLast();
    renderList();
  }

  function setRunning(on: boolean) {
    running = on;
    stage.editable = !on;
    if (on) {
      const lines = stage.measurementLines();
      if (!lines) return;
      store.saveLines({ lineA: lines[0], lineB: lines[1], videoW: preview.videoWidth, videoH: preview.videoHeight, posA, posB });
      build(lines);
      try {
        audio = audio ?? new AudioContext();
        void audio.resume();
      } catch {
        audio = null;
      }
      (navigator as Navigator & { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock
        ?.request('screen')
        .then((l) => (wakeLock = l))
        .catch(() => {});
      controls.replaceChildren(
        h('div.row', {},
          h('button.ghost', { type: 'button', onclick: () => setRunning(false) }, 'Pause / adjust lines'),
          h('button.ghost', { type: 'button', onclick: () => nav.home() }, 'Finish'),
        ),
        soundChips,
      );
      instruction.hidden = true;
      setupExtras.hidden = true;
      lastCard.hidden = false;
      renderLast();
    } else {
      void wakeLock?.release().catch(() => {});
      wakeLock = null;
      controls.replaceChildren(startBtn);
      instruction.hidden = false;
      setupExtras.hidden = false;
      lastCard.hidden = balls.length === 0;
      updateSetup();
    }
  }
  startBtn.addEventListener('click', () => setRunning(true));

  const lineOpts = h(
    'details.more',
    {},
    h('summary', {}, 'Change what the lines mark'),
    h('p.hint', {}, 'Line 1 (yellow)'),
    chips<number>(
      [
        { value: PITCH.bowlerCrease, label: 'Bowler’s crease' },
        { value: PITCH.bowlerStumps, label: 'Bowler’s stumps' },
      ],
      posA,
      (v) => ((posA = v), names(), updateSetup()),
      'Line 1 position',
    ),
    h('p.hint', {}, 'Line 2 (blue)'),
    chips<number>(
      [
        { value: PITCH.batterStumps, label: 'Batter’s stumps' },
        { value: PITCH.batterCrease, label: 'Batter’s crease' },
      ],
      posB,
      (v) => ((posB = v), names(), updateSetup()),
      'Line 2 position',
    ),
  );
  const setupExtras = h('div.setup-extras', {}, h('div.row.wrap', {}, reuse, reset), lineOpts);

  nav.show(
    h(
      'main.screen.live',
      {},
      h(
        'header.bar',
        {},
        h('button.icon', { type: 'button', 'aria-label': 'Back to start', onclick: () => nav.home() }, '←'),
        h('div.title', {}, h('strong', {}, 'Live speed gun'), h('small', {}, 'Real-time, no recording')),
      ),
      h('div.stage-wrap.live-stage', {}, stage.canvas, status),
      instruction,
      lastCard,
      controls,
      setupExtras,
      detailsEl,
      listEl,
    ),
  );
  controls.replaceChildren(startBtn);
  lastCard.hidden = true;
  detailsEl.hidden = true;
  updateSetup();

  nav.onLeave(() => {
    stopped = true;
    clearTimeout(trackTimer);
    cam?.stop();
    void wakeLock?.release().catch(() => {});
    void audio?.close().catch(() => {});
    holder.remove();
  });

  try {
    cam = await openCamera(preview);
  } catch (e) {
    if (stopped) return;
    status.textContent = '';
    instruction.textContent = (e as Error).message;
    startBtn.disabled = true;
    return;
  }
  if (stopped) return cam.stop();
  if (saved && saved.videoW === preview.videoWidth && saved.videoH === preview.videoHeight) reuse.hidden = false;

  const onFrame = (now: number, meta?: FrameMeta) => {
    if (stopped) return;
    // Prefer the camera's capture timestamp; fall back to the media clock, then wall time.
    if (useCapture === null) useCapture = typeof meta?.captureTime === 'number';
    const t = (useCapture ? meta!.captureTime! : meta ? meta.mediaTime * 1000 : now) / 1000;
    if (t > lastT) {
      if (lastT) {
        const inst = 1 / (t - lastT);
        fpsEma = fpsEma ? fpsEma * 0.95 + inst * 0.05 : inst;
      }
      lastT = t;
      if (running && detector && gun && grab) {
        const fb = detector.push(grab(), t, frameIndex++);
        shaky = detector.noise > 6 ? Math.min(60, shaky + 1) : Math.max(0, shaky - 2);
        if (fb) {
          const a = gun.push(fb);
          if (a) onDelivery(a);
        }
      }
    }
    stage.render();
    const fpsText = fpsEma ? `${Math.round(fpsEma)} fps` : '';
    status.textContent = running
      ? shaky > 20
        ? '⚠ Hold the phone still'
        : `● Watching · ${fpsText}`
      : fpsText;
    status.className = `live-status${running ? (shaky > 20 ? ' warn' : ' on') : ''}`;
    schedule();
  };
  const schedule = () => {
    if (stopped) return;
    if (preview.requestVideoFrameCallback) preview.requestVideoFrameCallback(onFrame);
    else requestAnimationFrame((now) => onFrame(now));
  };
  if (!preview.requestVideoFrameCallback) toast('This browser gives less precise frame timing. Results may be less accurate.');
  schedule();
}
