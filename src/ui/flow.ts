import { h, chips, toast } from './dom';
import { Stage } from './stage';
import { store } from './store';
import { conv, fmtSpeed, unitLabel } from './format';
import { confidenceText, detailsContent, model, saveDelivery } from './details';
import { MotionDetector, FrameBlobs } from '../core/detector';
import { Gate, Line } from '../core/geometry';
import { Analysis, AnalysisError, analyzeAuto, analyzeManual, medianDt } from '../core/analysis';
import { analysisRegion, detectorParams, fromRegion, toRegion, Region } from '../core/roi';
import { PITCH } from '../core/physics';
import { SCAN_CHANNELS, fixDuration, probeFps, scanFps, scanVideo, waitSeek } from '../video/scan';

/** Everything we know about the video currently being measured. */
export interface Session {
  url: string;
  video: HTMLVideoElement;
  /** Frame rate of the file's timeline. */
  fileFps: number;
  /** Real capture frame rate if the video is slow motion (else undefined). */
  slowMoFps?: number;
  posA: number;
  posB: number;
  lines?: [Line, Line];
  /** Raw media timestamps of all frames. */
  times?: number[];
  frames?: FrameBlobs[];
  region?: Region;
  analysis?: Analysis;
  deliveryId?: string;
}

export interface Nav {
  show(el: HTMLElement): void;
  home(): void;
  /** Runs `fn` when the current screen is left (stop the camera etc.). */
  onLeave(fn: () => void): void;
}

/** Real seconds per second of media time. */
const timeScale = (s: Session) => (s.slowMoFps ? s.fileFps / s.slowMoFps : 1);
const realFps = (s: Session) => s.slowMoFps ?? s.fileFps;

function header(nav: Nav, title: string, step?: string): HTMLElement {
  return h(
    'header.bar',
    {},
    h('button.icon', { type: 'button', 'aria-label': 'Back to start', onclick: () => nav.home() }, '←'),
    h('div.title', {}, h('strong', {}, title), step ? h('small', {}, step) : null),
  );
}

let videoHolder: HTMLElement | null = null;

/** Loads a recorded or imported video and opens the line-setup screen. */
export async function openVideo(nav: Nav, file: Blob): Promise<void> {
  nav.show(busy('Opening video…'));
  if (!videoHolder) {
    videoHolder = h('div.video-holder', { 'aria-hidden': 'true' });
    document.body.append(videoHolder);
  }
  const old = videoHolder.querySelector('video');
  if (old) {
    URL.revokeObjectURL(old.src);
    old.remove();
  }
  const url = URL.createObjectURL(file);
  const video = h('video', { playsinline: true, muted: true, preload: 'auto' });
  video.muted = true;
  video.src = url;
  videoHolder.append(video);
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('unsupported')), { once: true });
      setTimeout(() => reject(new Error('timeout')), 20000);
    });
    await fixDuration(video);
  } catch {
    toast('Sorry, this video could not be opened. Try an MP4 or MOV file.');
    nav.home();
    return;
  }
  const probed = await probeFps(video);
  const fileFps = probed ? Math.round(probed) : 30;
  const session: Session = { url, video, fileFps, posA: PITCH.bowlerCrease, posB: PITCH.batterStumps };
  const saved = store.lines();
  if (saved && saved.videoW === video.videoWidth && saved.videoH === video.videoHeight) {
    session.posA = saved.posA;
    session.posB = saved.posB;
  }
  video.currentTime = Math.min(video.duration * 0.25 || 0, 1);
  await waitSeek(video);
  setupScreen(nav, session);
}

function busy(msg: string, onCancel?: () => void): HTMLElement {
  const bar = h('div.progress', {}, h('div.fill'));
  return h(
    'main.screen.center',
    {},
    h('div.spinner', { 'aria-hidden': 'true' }),
    h('p.busy-msg', { 'aria-live': 'polite' }, msg),
    bar,
    onCancel ? h('button.ghost', { type: 'button', onclick: onCancel }, 'Cancel') : null,
  );
}

function setProgress(el: HTMLElement, f: number, msg?: string) {
  const fill = el.querySelector<HTMLElement>('.fill');
  if (fill) fill.style.width = `${Math.round(f * 100)}%`;
  if (msg) el.querySelector('.busy-msg')!.textContent = msg;
}

function frameScrubber(session: Session, stage: Stage): HTMLElement {
  const v = session.video;
  const input = h('input', {
    type: 'range',
    min: 0,
    max: 1000,
    value: Math.round((v.currentTime / (v.duration || 1)) * 1000),
    'aria-label': 'Move through the video',
  }) as HTMLInputElement;
  let pending = false;
  input.addEventListener('input', async () => {
    if (pending) return;
    pending = true;
    v.currentTime = (Number(input.value) / 1000) * (v.duration || 0);
    await waitSeek(v);
    stage.render();
    pending = false;
  });
  return h('label.scrub', {}, h('span', {}, 'Video'), input);
}

/* ------------------------------------------------------------------ setup */

function setupScreen(nav: Nav, session: Session): void {
  const stage = new Stage(session.video);
  stage.editable = true;
  const saved = store.lines();
  const v = session.video;
  if (session.lines) stage.setLines(session.lines);

  const names = () => {
    stage.lineNames = [
      session.posA === PITCH.bowlerStumps ? 'Bowler’s stumps' : 'Bowler’s crease',
      session.posB === PITCH.batterCrease ? 'Batter’s crease' : 'Batter’s stumps',
    ];
  };
  names();

  const instruction = h('div.instruction', { 'aria-live': 'polite' });
  const measureBtn = h('button.primary.big', { type: 'button', onclick: () => run('auto') }, 'Measure speed') as HTMLButtonElement;
  const handBtn = h('button.ghost', { type: 'button', onclick: () => run('manual') }, 'Mark the ball by hand instead');

  const update = () => {
    const n = stage.nextLine;
    const what1 = session.posA === PITCH.bowlerStumps ? 'the bottom of the <b>bowler’s stumps</b>' : 'the <b>bowler’s crease</b> (the white line the front foot lands on), in the middle of the pitch';
    const what2 = session.posB === PITCH.batterCrease ? 'the <b>batter’s crease</b> (white line in front of the batter), in the middle of the pitch' : 'the bottom of the <b>batter’s stumps</b>';
    instruction.innerHTML =
      n === 0
        ? `<span class="badge y">1</span> Tap ${what1}.`
        : n === 1
          ? `<span class="badge b">2</span> Now tap ${what2}.`
          : `<span class="badge ok">✓</span> Lines set. Drag a circle to fine-tune — drag a <b>top</b> circle to tilt a line so it matches the stumps.`;
    measureBtn.disabled = n !== -1;
  };
  stage.onChange = update;
  update();

  const reuse =
    saved && saved.videoW === v.videoWidth && saved.videoH === v.videoHeight
      ? h(
          'button.ghost.small',
          {
            type: 'button',
            onclick: () => {
              stage.setLines([saved.lineA, saved.lineB]);
              update();
            },
          },
          'Use my lines from last time',
        )
      : null;

  const reset = h(
    'button.ghost.small',
    {
      type: 'button',
      onclick: () => {
        stage.setLines(null);
        update();
      },
    },
    'Reset lines',
  );

  const filmed = chips<number>(
    [
      { value: 0, label: 'Normal' },
      { value: 120, label: 'Slow-mo 120' },
      { value: 240, label: 'Slow-mo 240' },
      { value: 480, label: '480' },
      { value: 960, label: '960' },
    ],
    session.slowMoFps ?? 0,
    (val) => {
      session.slowMoFps = val || undefined;
    },
    'How the video was filmed',
  );

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
      session.posA,
      (val) => {
        session.posA = val;
        names();
        stage.render();
        update();
      },
      'Line 1 position',
    ),
    h('p.hint', {}, 'Line 2 (blue)'),
    chips<number>(
      [
        { value: PITCH.batterStumps, label: 'Batter’s stumps' },
        { value: PITCH.batterCrease, label: 'Batter’s crease' },
      ],
      session.posB,
      (val) => {
        session.posB = val;
        names();
        stage.render();
        update();
      },
      'Line 2 position',
    ),
    h('p.hint', {}, 'Tip: the batter’s crease works better if the batter usually hits the ball before it reaches the stumps.'),
  );

  async function run(mode: 'auto' | 'manual') {
    const ml = stage.measurementLines();
    if (mode === 'auto' && !ml) return;
    session.lines = ml ?? undefined;
    if (ml) {
      store.saveLines({ lineA: ml[0], lineB: ml[1], videoW: v.videoWidth, videoH: v.videoHeight, posA: session.posA, posB: session.posB });
    }
    const ok = await scan(nav, session);
    if (!ok) return setupScreen(nav, session);
    if (mode === 'manual') return manualScreen(nav, session);
    autoAnalyze(nav, session);
  }

  nav.show(
    h(
      'main.screen',
      {},
      header(nav, 'Mark the pitch', 'Step 1 of 2'),
      h('div.stage-wrap', {}, stage.canvas),
      instruction,
      h('div.row.wrap', {}, reuse, reset),
      frameScrubber(session, stage),
      h(
        'section.card',
        {},
        h('p.label', {}, 'How was it filmed?'),
        filmed,
        h('p.hint', {}, `This video plays at about ${session.fileFps} fps. If it plays back in slow motion, pick the slow-mo setting you used.`),
      ),
      lineOpts,
      h('div.actions', {}, measureBtn, handBtn),
    ),
  );
  requestAnimationFrame(() => stage.render());
}

/* ------------------------------------------------------------------- scan */

/** Decodes all frames: records timestamps and (when lines are set) detects moving blobs. */
async function scan(nav: Nav, session: Session): Promise<boolean> {
  const v = session.video;
  const ctrl = new AbortController();
  const screen = busy('Finding the ball…', () => ctrl.abort());
  nav.show(screen);
  const distance = session.posB - session.posA;
  const scale = timeScale(session);
  const region: Region = session.lines
    ? analysisRegion(session.lines[0], session.lines[1], distance, v.videoWidth, v.videoHeight)
    : // Timestamps only: a tiny crop keeps this fast.
      { x: 0, y: 0, w: 8, h: 8, scale: 1 };
  const makeDetector = () => {
    if (!session.lines) return null;
    const gate = new Gate(toRegion(session.lines[0], region), toRegion(session.lines[1], region));
    const p = detectorParams(gate.spanPx / distance, 1 / realFps(session));
    const width = Math.max(8, Math.round(region.w * region.scale));
    const height = Math.max(8, Math.round(region.h * region.scale));
    return new MotionDetector({ width, height, channels: SCAN_CHANNELS, ...p });
  };
  try {
    // If the browser had to skip frames, go again more slowly.
    for (let attempt = 0, slowdown = 1; ; attempt++, slowdown *= 2.5) {
      const detector = makeDetector();
      const frames: FrameBlobs[] = [];
      const label = attempt ? 'Checking again more carefully\u2026' : 'Finding the ball\u2026';
      const res = await scanVideo(v, {
        crop: region,
        nominalFps: session.fileFps,
        slowdown,
        signal: ctrl.signal,
        onProgress: (f) => setProgress(screen, f, `${label} ${Math.round(f * 100)}%`),
        onFrame: (gray, t, i) => {
          const r = detector?.push(gray, t * scale, i);
          if (r) frames.push(r);
        },
      });
      const dropRate = res.dropped / Math.max(1, res.times.length + res.dropped);
      console.info(`scan ${attempt + 1}: ${res.times.length} frames, ${res.dropped} skipped`);
      if (dropRate > 0.01 && attempt < 2) continue;
      session.times = res.times;
      session.frames = frames;
      session.region = region;
      const fps = dropRate <= 0.01 ? scanFps(res.times) : undefined;
      if (fps) session.fileFps = Math.round(fps);
      return true;
    }
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') toast('Something went wrong reading the video.');
    return false;
  }
}

/* -------------------------------------------------------------- analysis */

function autoAnalyze(nav: Nav, session: Session): void {
  const [A, B] = session.lines!;
  const r = session.region!;
  try {
    const a = analyzeAuto(session.frames!, { lineA: toRegion(A, r), lineB: toRegion(B, r), posA: session.posA, posB: session.posB }, model());
    // Report the track in video coordinates.
    a.track = a.track.map((p) => ({ ...p, ...fromRegion(p, r) }));
    session.analysis = a;
    session.deliveryId = undefined;
    resultScreen(nav, session);
  } catch (e) {
    if (!(e instanceof AnalysisError)) throw e;
    nav.show(
      h(
        'main.screen.center',
        {},
        h('div.big-icon', { 'aria-hidden': 'true' }, '🔍'),
        h('h2', {}, 'Ball not found'),
        h('p.lead', {}, e.message),
        h('div.actions', {},
          h('button.primary.big', { type: 'button', onclick: () => manualScreen(nav, session) }, 'Mark the ball by hand'),
          h('button.ghost', { type: 'button', onclick: () => setupScreen(nav, session) }, 'Adjust the lines'),
          h('button.ghost', { type: 'button', onclick: () => nav.home() }, 'Try another video'),
        ),
      ),
    );
  }
}

/* ----------------------------------------------------------------- result */

function resultScreen(nav: Nav, session: Session): void {
  const a = session.analysis!;
  let s = store.settings();
  if (!session.deliveryId) session.deliveryId = saveDelivery(a, realFps(session));

  const big = h('div.speed', { 'aria-live': 'polite' });
  const renderBig = () => {
    s = store.settings();
    const u = unitLabel(s.unit);
    const c = conv(s.unit);
    const val = s.headline === 'release' ? a.speed.release : a.speed.average;
    big.replaceChildren(
      h('div.speed-num', {}, fmtSpeed(val, s.unit)),
      h('div.speed-unit', {}, u),
      h('div.speed-label', {}, s.headline === 'release' ? 'Speed out of the hand' : 'Average speed down the pitch'),
      h(`div.conf.${a.confidence}`, {}, confidenceText(a, u, c)),
      a.mode === 'manual' ? h('div.hint', {}, 'Measured from the frames you picked') : '',
    );
  };
  renderBig();

  const unitChips = chips(
    [
      { value: 'kmh' as const, label: 'km/h' },
      { value: 'mph' as const, label: 'mph' },
    ],
    s.unit,
    (unit) => {
      store.saveSettings({ unit });
      renderBig();
      renderDetails();
    },
    'Speed unit',
  );

  const bowler = h('input', { type: 'text', value: s.bowler, placeholder: 'Bowler name (optional)', 'aria-label': 'Bowler name', autocomplete: 'off', maxlength: 40 }) as HTMLInputElement;
  bowler.addEventListener('change', () => {
    store.saveSettings({ bowler: bowler.value.trim() });
    store.updateDelivery(session.deliveryId!, { bowler: bowler.value.trim() });
    toast('Saved');
  });

  const details = h('details.more.details', {});
  const detailsBody = h('div');
  details.append(h('summary', {}, 'Detailed analysis'), detailsBody);
  let replay: Stage | null = null;
  const renderDetails = () => {
    let replayBlock: HTMLElement | null = null;
    if (a.track.length && session.times?.length) {
      replay = new Stage(session.video);
      replay.lines = session.lines!.map((l) => ({ base: l.a, top: l.b }));
      replay.lineNames = ['', ''];
      replay.track = a.track;
      const scale = timeScale(session);
      const times = session.times;
      const first = Math.max(0, times.findIndex((t) => t * scale >= a.track[0].t) - 8);
      let last = times.findIndex((t) => t * scale > a.track[a.track.length - 1].t);
      last = last < 0 ? times.length - 1 : Math.min(times.length - 1, last + 8);
      const slider = h('input', { type: 'range', min: first, max: last, value: first, 'aria-label': 'Replay frame' }) as HTMLInputElement;
      const rawDt = medianDt(times);
      const showFrame = async (i: number, whole = false) => {
        session.video.currentTime = times[i] + rawDt * 0.25;
        await waitSeek(session.video);
        replay!.trackUntil = whole ? undefined : times[i] * scale + 1e-6;
        replay!.render();
      };
      slider.addEventListener('input', () => showFrame(Number(slider.value)));
      let playing = false;
      const play = h('button.ghost.small', { type: 'button' }, '▶ Play') as HTMLButtonElement;
      play.addEventListener('click', async () => {
        if (playing) return;
        playing = true;
        for (let i = first; i <= last && details.open; i++) {
          slider.value = String(i);
          await showFrame(i);
          await new Promise((r) => setTimeout(r, 70));
        }
        playing = false;
      });
      replayBlock = h('figure', {}, h('figcaption', {}, 'Ball path'), h('div.stage-wrap', {}, replay.canvas), h('div.row', {}, play, slider));
      requestAnimationFrame(() => showFrame(first, true));
    }

    detailsBody.replaceChildren(
      ...detailsContent(a, { posA: session.posA, posB: session.posB, fps: realFps(session), slowMo: !!session.slowMoFps }, [
        replayBlock,
        h('div.row.wrap', {}, h('button.ghost.small', { type: 'button', onclick: () => manualScreen(nav, session) }, 'Check / fix by hand')),
      ]),
    );
  };
  renderDetails();

  const share = async () => {
    const st = store.settings();
    const text = `${bowler.value ? bowler.value + ' bowled' : 'Bowled'} at ${fmtSpeed(a.speed.release, st.unit)} ${unitLabel(st.unit)}${a.bounce ? ` (${a.bounce.length.toLowerCase()})` : ''} — measured with Cricket Speed Gun`;
    try {
      if (navigator.share) await navigator.share({ text, url: location.href.split('#')[0] });
      else {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard');
      }
    } catch {
      /* user cancelled */
    }
  };

  nav.show(
    h(
      'main.screen.result',
      {},
      header(nav, 'Result', 'Step 2 of 2'),
      big,
      unitChips,
      h('div.row', {}, bowler),
      h('div.actions', {},
        h('button.primary.big', { type: 'button', onclick: () => nav.home() }, 'Measure another ball'),
        h('div.row', {},
          h('button.ghost', { type: 'button', onclick: share }, 'Share'),
          h('button.ghost', { type: 'button', onclick: () => setupScreen(nav, session) }, 'Adjust lines'),
        ),
      ),
      details,
    ),
  );
}

/* ----------------------------------------------------------------- manual */

function manualScreen(nav: Nav, session: Session): void {
  const times = session.times!;
  if (!times.length) {
    toast('No frames found in this video.');
    return nav.home();
  }
  const scale = timeScale(session);
  const rawDt = medianDt(times);
  const stage = new Stage(session.video);
  if (session.lines) stage.setLines(session.lines);
  stage.editable = false;
  stage.lineNames = [
    session.posA === PITCH.bowlerStumps ? 'Bowler’s stumps' : 'Bowler’s crease',
    session.posB === PITCH.batterCrease ? 'Batter’s crease' : 'Batter’s stumps',
  ];
  // Start near the auto result if there is one.
  const startT = session.analysis ? session.analysis.tA / scale : times[0];
  let i = Math.max(0, times.findIndex((t) => t >= startT));
  const marks: { A?: number; B?: number; bounce?: number } = {};
  if (session.analysis) {
    const near = (t: number) => times.reduce((best, x, k) => (Math.abs(x * scale - t) < Math.abs(times[best] * scale - t) ? k : best), 0);
    marks.A = near(session.analysis.tA);
    marks.B = near(session.analysis.tB);
    if (session.analysis.bounce && isFinite(session.analysis.bounce.t)) marks.bounce = near(session.analysis.bounce.t);
  }

  const counter = h('div.counter', { 'aria-live': 'polite' });
  const slider = h('input', { type: 'range', min: 0, max: times.length - 1, value: i, 'aria-label': 'Frame' }) as HTMLInputElement;
  let seq = 0;
  const show = async (k: number) => {
    i = Math.max(0, Math.min(times.length - 1, k));
    slider.value = String(i);
    const my = ++seq;
    session.video.currentTime = times[i] + rawDt * 0.25;
    await waitSeek(session.video);
    if (my !== seq) return;
    stage.render();
    const tags = [marks.A === i ? 'line 1' : '', marks.B === i ? 'line 2' : '', marks.bounce === i ? 'bounce' : ''].filter(Boolean).join(', ');
    counter.textContent = `Frame ${i + 1} of ${times.length}${tags ? ` — ${tags}` : ''}`;
    renderMarks();
  };
  slider.addEventListener('input', () => show(Number(slider.value)));

  const step = (d: number, label: string, aria: string) => h('button.step', { type: 'button', 'aria-label': aria, onclick: () => show(i + d) }, label);

  const markA = h('button.mark.y', { type: 'button', onclick: () => ((marks.A = i), show(i)) });
  const markB = h('button.mark.b', { type: 'button', onclick: () => ((marks.B = i), show(i)) });
  const markBounce = h('button.mark.w', { type: 'button', onclick: () => ((marks.bounce = marks.bounce === i ? undefined : i), show(i)) });
  const calc = h('button.primary.big', { type: 'button' }, 'Calculate speed') as HTMLButtonElement;
  const renderMarks = () => {
    markA.textContent = marks.A === undefined ? 'Ball at line 1' : `Line 1 ✓ (frame ${marks.A + 1})`;
    markB.textContent = marks.B === undefined ? 'Ball at line 2' : `Line 2 ✓ (frame ${marks.B + 1})`;
    markBounce.textContent = marks.bounce === undefined ? 'Bounce (optional)' : `Bounce ✓ (frame ${marks.bounce + 1})`;
    calc.disabled = marks.A === undefined || marks.B === undefined;
  };
  calc.addEventListener('click', () => {
    const tA = times[marks.A!] * scale;
    const tB = times[marks.B!] * scale;
    const D = session.posB - session.posA;
    // Bounce position: assume roughly even speed between the lines.
    const bounceFromA = marks.bounce !== undefined ? ((times[marks.bounce] * scale - tA) / (tB - tA)) * D : undefined;
    try {
      session.analysis = analyzeManual(tA, tB, rawDt * scale, session, model(), bounceFromA);
      session.deliveryId = undefined;
      resultScreen(nav, session);
    } catch (e) {
      toast((e as Error).message);
    }
  });

  nav.show(
    h(
      'main.screen',
      {},
      header(nav, 'Mark the ball', 'Step through frame by frame'),
      h('div.stage-wrap', {}, stage.canvas),
      counter,
      h('div.row.steps', {}, step(-10, '«', 'Back 10 frames'), step(-1, '‹', 'Back 1 frame'), step(1, '›', 'Forward 1 frame'), step(10, '»', 'Forward 10 frames')),
      slider,
      h(
        'p.instruction',
        {},
        session.lines
          ? 'Find the frame where the ball is level with each line, then tap the matching button.'
          : 'Find the frame where the ball leaves the bowler’s hand at the crease, and the frame where it reaches the batter’s stumps.',
      ),
      h('div.marks', {}, markA, markB, markBounce),
      h('div.actions', {}, calc),
    ),
  );
  renderMarks();
  requestAnimationFrame(() => show(i));
}
