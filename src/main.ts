import './styles.css';
import { h, chips, toast } from './ui/dom';
import { store } from './ui/store';
import { fmtDate, fmtSpeed, unitLabel, downloadText } from './ui/format';
import { Nav, openVideo } from './ui/flow';
import { liveScreen } from './ui/live';
import { openCamera, Recorder, CameraSession } from './video/record';

const root = document.getElementById('app')!;
let cleanup: (() => void) | null = null;

const nav: Nav = {
  show(el: HTMLElement) {
    cleanup?.();
    cleanup = null;
    root.replaceChildren(el);
    window.scrollTo(0, 0);
    const heading = el.querySelector<HTMLElement>('h1, h2, .title strong');
    heading?.setAttribute('tabindex', '-1');
  },
  home: () => homeScreen(),
  onLeave(fn) {
    cleanup = fn;
  },
};

function pickFile(): void {
  const input = h('input', { type: 'file', accept: 'video/*' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) openVideo(nav, f);
  });
  input.click();
}

/* ------------------------------------------------------------------- home */

function filmDiagram(): HTMLElement {
  // Side-on camera position relative to the pitch.
  return h('div.diagram', {
    html: `<svg viewBox="0 0 320 160" role="img" aria-label="Stand to the side of the pitch, level with the middle, so both ends are in view">
      <rect x="30" y="40" width="260" height="40" rx="4" class="d-pitch"/>
      <line x1="44" y1="36" x2="44" y2="84" class="d-crease"/><line x1="66" y1="36" x2="66" y2="84" class="d-crease"/>
      <line x1="276" y1="36" x2="276" y2="84" class="d-crease"/><line x1="254" y1="36" x2="254" y2="84" class="d-crease"/>
      <text x="44" y="28" text-anchor="middle" class="d-text">Bowler</text>
      <text x="276" y="28" text-anchor="middle" class="d-text">Batter</text>
      <path d="M160 128 L120 86 M160 128 L200 86" class="d-view"/>
      <rect x="148" y="124" width="24" height="14" rx="3" class="d-phone"/>
      <text x="160" y="156" text-anchor="middle" class="d-text">You, 15–25 m away, phone sideways</text>
    </svg>`,
  });
}

function homeScreen(): void {
  const s = store.settings();
  const hist = store.history();
  const today = hist.filter((d) => new Date(d.date).toDateString() === new Date().toDateString());
  const fastest = hist.length ? hist.reduce((a, b) => (b.release > a.release ? b : a)) : null;

  const tips = h(
    'details.more.tips',
    { open: !s.seenIntro },
    h('summary', {}, 'How to film for an accurate reading'),
    filmDiagram(),
    h(
      'ol.tip-list',
      {},
      h('li', {}, h('b', {}, 'Side-on. '), 'Stand level with the middle of the pitch so you can see both sets of stumps.'),
      h('li', {}, h('b', {}, 'Keep still. '), 'Lean on something or use a tripod. Hold the phone sideways.'),
      h('li', {}, h('b', {}, 'Use slow-motion if you can. '), 'Film in your camera app’s Slo-mo mode (120 or 240 fps), then tap “Use a video”. More frames = more accurate.'),
      h('li', {}, h('b', {}, 'Short clips. '), 'Start just before the run-up ends and stop after the ball reaches the batter.'),
      h('li', {}, h('b', {}, 'Live mode: '), 'put the phone on a tripod or prop it up so it doesn\u2019t move. You get a speed after every ball, hands-free.'),
    ),
  );
  tips.addEventListener('toggle', () => store.saveSettings({ seenIntro: true }));

  nav.show(
    h(
      'main.screen.home',
      {},
      h(
        'header.bar',
        {},
        h('div.brand', {}, h('span.logo', { 'aria-hidden': 'true' }, '●'), h('h1', {}, 'Cricket Speed Gun')),
        h('button.icon', { type: 'button', 'aria-label': 'Settings', onclick: settingsScreen }, '⚙'),
      ),
      h('p.lead', {}, 'Measure how fast a ball is bowled using your phone’s camera.'),
      h(
        'div.home-actions',
        {},
        h('button.primary.huge', { type: 'button', onclick: recordScreen }, h('span.ico', { 'aria-hidden': 'true' }, '⏺'), h('span.txt', {}, 'Record a ball', h('small', {}, 'Film it right here in the app'))),
        h('button.secondary.huge.live-btn', { type: 'button', onclick: () => liveScreen(nav) }, h('span.ico', { 'aria-hidden': 'true' }, '\u26A1'), h('span.txt', {}, 'Live speed gun', h('small', {}, 'Real time: speed pops up after every ball'))),
        h('button.secondary.huge', { type: 'button', onclick: pickFile }, h('span.ico', { 'aria-hidden': 'true' }, '⇧'), h('span.txt', {}, 'Use a video', h('small', {}, 'Best: a slow-motion video from your camera'))),
      ),
      hist.length
        ? h(
            'button.card.summary',
            { type: 'button', onclick: historyScreen },
            h('div', {}, h('small', {}, 'Fastest'), h('strong', {}, `${fmtSpeed(fastest!.release, s.unit)} ${unitLabel(s.unit)}`)),
            h('div', {}, h('small', {}, 'Today'), h('strong', {}, `${today.length} ball${today.length === 1 ? '' : 's'}`)),
            h('div', {}, h('small', {}, 'All'), h('strong', {}, `${hist.length}`)),
            h('span.chev', { 'aria-hidden': 'true' }, '›'),
          )
        : null,
      tips,
      h('footer.foot', {}, h('button.link', { type: 'button', onclick: helpScreen }, 'Help & accuracy'), ' · ', h('button.link', { type: 'button', onclick: historyScreen }, 'History')),
    ),
  );
}

/* ----------------------------------------------------------------- record */

async function recordScreen(): Promise<void> {
  const preview = h('video.preview', { playsinline: true, muted: true, autoplay: true });
  const status = h('div.rec-status', { 'aria-live': 'polite' }, 'Starting camera…');
  const btn = h('button.rec', { type: 'button', 'aria-label': 'Start recording', disabled: true }) as HTMLButtonElement;
  const guide = h(
    'div.guide',
    { 'aria-hidden': 'true' },
    h('div.g-line.left', {}, h('span', {}, 'Bowler')),
    h('div.g-line.right', {}, h('span', {}, 'Batter')),
  );
  const screen = h(
    'main.screen.record',
    {},
    h('header.bar.overlay', {}, h('button.icon', { type: 'button', 'aria-label': 'Back', onclick: () => nav.home() }, '←'), status),
    h('div.cam', {}, preview, guide),
    h('p.cam-tip', {}, 'Side-on, phone sideways, both ends of the pitch in view. Keep still.'),
    h('div.rec-bar', {}, btn),
  );
  nav.show(screen);

  let cam: CameraSession | null = null;
  let rec: Recorder | null = null;
  let timer = 0;
  let stopTimer = 0;
  cleanup = () => {
    clearInterval(timer);
    clearTimeout(stopTimer);
    cam?.stop();
  };
  try {
    cam = await openCamera(preview);
  } catch (e) {
    status.textContent = '';
    screen.querySelector('.cam')!.replaceChildren(
      h('div.cam-error', {}, h('p', {}, (e as Error).message), h('button.primary', { type: 'button', onclick: pickFile }, 'Use a video instead')),
    );
    return;
  }
  const lowFps = cam.fps < 50;
  status.textContent = `${cam.fps} fps${lowFps ? ' — tip: slow-mo video is more accurate' : ''}`;
  btn.disabled = false;

  const stop = async () => {
    if (!rec) return;
    clearInterval(timer);
    clearTimeout(stopTimer);
    btn.disabled = true;
    const blob = await rec.stop();
    rec = null;
    cam?.stop();
    openVideo(nav, blob);
  };

  btn.addEventListener('click', () => {
    if (rec) return void stop();
    try {
      rec = new Recorder(cam!.stream);
    } catch {
      toast('Recording is not supported in this browser. Use your camera app, then “Use a video”.');
      return;
    }
    rec.start();
    btn.classList.add('on');
    btn.setAttribute('aria-label', 'Stop recording');
    const t0 = Date.now();
    timer = window.setInterval(() => (status.textContent = `● REC ${((Date.now() - t0) / 1000).toFixed(1)} s — tap to stop`), 100);
    stopTimer = window.setTimeout(stop, 10000);
  });
}

/* ---------------------------------------------------------------- history */

function historyScreen(): void {
  const s = store.settings();
  const list = store.history();
  const u = unitLabel(s.unit);
  const bowlers = [...new Set(list.map((d) => d.bowler).filter(Boolean))];
  let filter = '';

  const body = h('div');
  const render = () => {
    const items = filter ? list.filter((d) => d.bowler === filter) : list;
    if (!items.length) {
      body.replaceChildren(h('p.empty', {}, 'No balls measured yet. Your speeds will appear here.'));
      return;
    }
    const speeds = items.map((d) => d.release);
    const max = Math.max(...speeds);
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    body.replaceChildren(
      h(
        'div.stat-cards',
        {},
        h('div.card', {}, h('small', {}, 'Fastest'), h('strong', {}, `${fmtSpeed(max, s.unit)}`), h('small', {}, u)),
        h('div.card', {}, h('small', {}, 'Average'), h('strong', {}, `${fmtSpeed(avg, s.unit)}`), h('small', {}, u)),
        h('div.card', {}, h('small', {}, 'Balls'), h('strong', {}, `${items.length}`), h('small', {}, ' ')),
      ),
      h(
        'ul.history',
        {},
        ...items.map((d) =>
          h(
            'li',
            {},
            h('div.h-speed', {}, fmtSpeed(d.release, s.unit), h('small', {}, u)),
            h(
              'div.h-meta',
              {},
              h('strong', {}, d.bowler || 'Unnamed bowler'),
              h('small', {}, [fmtDate(d.date), d.length, d.mode === 'manual' ? 'by hand' : null].filter(Boolean).join(' · ')),
            ),
            h(
              'button.icon.small',
              {
                type: 'button',
                'aria-label': 'Delete',
                onclick: () => {
                  store.removeDelivery(d.id);
                  historyScreen();
                },
              },
              '✕',
            ),
          ),
        ),
      ),
    );
  };
  render();

  nav.show(
    h(
      'main.screen',
      {},
      h('header.bar', {}, h('button.icon', { type: 'button', 'aria-label': 'Back', onclick: () => nav.home() }, '←'), h('div.title', {}, h('strong', {}, 'History'))),
      bowlers.length > 1
        ? chips(
            [{ value: '', label: 'Everyone' }, ...bowlers.map((b) => ({ value: b, label: b }))],
            '',
            (v) => {
              filter = v;
              render();
            },
            'Filter by bowler',
          )
        : null,
      body,
      list.length
        ? h(
            'div.row.wrap',
            {},
            h(
              'button.ghost.small',
              {
                type: 'button',
                onclick: () => {
                  const rows = ['date,bowler,release_kmh,average_kmh,error_kmh,length,pitched_m_from_stumps,confidence,method,fps'];
                  for (const d of list) {
                    rows.push(
                      [
                        new Date(d.date).toISOString(),
                        `"${d.bowler.replace(/"/g, '""')}"`,
                        (d.release * 3.6).toFixed(1),
                        (d.average * 3.6).toFixed(1),
                        (d.error * 3.6).toFixed(1),
                        d.length ?? '',
                        d.bounceFromStumps?.toFixed(1) ?? '',
                        d.confidence,
                        d.mode,
                        d.fps,
                      ].join(','),
                    );
                  }
                  downloadText('cricket-speeds.csv', rows.join('\n'));
                },
              },
              'Download all (CSV)',
            ),
            h(
              'button.ghost.small.danger',
              {
                type: 'button',
                onclick: () => {
                  if (confirm('Delete all saved speeds?')) {
                    store.clearHistory();
                    historyScreen();
                  }
                },
              },
              'Clear history',
            ),
          )
        : null,
    ),
  );
}

/* --------------------------------------------------------------- settings */

function settingsScreen(): void {
  const s = store.settings();
  const cd = h('input', { type: 'number', min: 0.2, max: 0.8, step: 0.01, value: s.cd, inputmode: 'decimal' }) as HTMLInputElement;
  const br = h('input', { type: 'number', min: 50, max: 100, step: 1, value: s.bounceRetention, inputmode: 'numeric' }) as HTMLInputElement;
  cd.addEventListener('change', () => store.saveSettings({ cd: Math.min(0.8, Math.max(0.2, Number(cd.value) || 0.45)) }));
  br.addEventListener('change', () => store.saveSettings({ bounceRetention: Math.min(100, Math.max(50, Number(br.value) || 90)) }));
  nav.show(
    h(
      'main.screen',
      {},
      h('header.bar', {}, h('button.icon', { type: 'button', 'aria-label': 'Back', onclick: () => nav.home() }, '←'), h('div.title', {}, h('strong', {}, 'Settings'))),
      h(
        'section.card',
        {},
        h('p.label', {}, 'Units'),
        chips(
          [
            { value: 'kmh' as const, label: 'km/h' },
            { value: 'mph' as const, label: 'mph' },
          ],
          s.unit,
          (unit) => store.saveSettings({ unit }),
          'Units',
        ),
        h('p.label', {}, 'Main number to show'),
        chips(
          [
            { value: 'release' as const, label: 'Out of the hand' },
            { value: 'average' as const, label: 'Average' },
          ],
          s.headline,
          (headline) => store.saveSettings({ headline }),
          'Main number',
        ),
        h('p.hint', {}, '“Out of the hand” matches TV speed guns. “Average” is distance ÷ time with no physics model.'),
      ),
      h(
        'details.more',
        {},
        h('summary', {}, 'Advanced (physics model)'),
        h('label.field', {}, h('span', {}, 'Ball drag coefficient'), cd),
        h('label.field', {}, h('span', {}, 'Speed kept after bounce (%)'), br),
        h('p.hint', {}, 'Defaults: 0.45 and 90%. Lower the bounce figure for soft or grassy pitches, raise it for hard, fast pitches.'),
        h(
          'button.ghost.small',
          {
            type: 'button',
            onclick: () => {
              store.saveSettings({ cd: 0.45, bounceRetention: 90 });
              settingsScreen();
              toast('Defaults restored');
            },
          },
          'Restore defaults',
        ),
      ),
      h('p.hint.center', {}, 'Everything stays on your phone. Videos are never uploaded.'),
    ),
  );
}

/* ------------------------------------------------------------------- help */

function helpScreen(): void {
  const row = (fps: string, err: string) => h('tr', {}, h('td', {}, fps), h('td', {}, err));
  nav.show(
    h(
      'main.screen.help',
      {},
      h('header.bar', {}, h('button.icon', { type: 'button', 'aria-label': 'Back', onclick: () => nav.home() }, '←'), h('div.title', {}, h('strong', {}, 'Help & accuracy'))),
      h('h2', {}, 'Three steps'),
      h(
        'ol.tip-list',
        {},
        h('li', {}, h('b', {}, 'Film the ball. '), 'Record in the app, or use a video from your camera (slow-mo is best).'),
        h('li', {}, h('b', {}, 'Tap two spots. '), 'The bowler’s crease and the bottom of the batter’s stumps. The app remembers them next time.'),
        h('li', {}, h('b', {}, 'Get the speed. '), 'The app finds the ball and times it between the two spots.'),
      ),
      filmDiagram(),
      h('h2', {}, 'How accurate is it?'),
      h('p', {}, 'Accuracy depends mostly on the frame rate. Typical accuracy for a 130 km/h ball:'),
      h('table.acc', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Video'), h('th', {}, 'Accuracy'))), h('tbody', {}, row('30 fps', '± 3–6 km/h'), row('60 fps', '± 2–3 km/h'), row('120 fps slow-mo', '± 1–2 km/h'), row('240 fps slow-mo', '± 0.5–1 km/h'))),
      h('p', {}, 'Every result shows its own ± range, so you know how much to trust it.'),
      h('h2', {}, 'If the ball isn’t found'),
      h(
        'ul.tip-list',
        {},
        h('li', {}, 'Make sure both lines are on the pitch and the phone didn’t move.'),
        h('li', {}, 'Film in good light; avoid a white ball against white sightscreens.'),
        h('li', {}, 'Use “Mark the ball by hand”: step frame by frame and tap when the ball reaches each line.'),
      ),
      h('h2', {}, 'Slow-motion videos'),
      h('p', {}, 'Many phones save slow-mo videos so they play back slowly. On the “Mark the pitch” screen choose the slow-mo setting you filmed with (e.g. 240) so the time is worked out correctly. If your slow-mo video plays at normal speed in the app, leave it on “Normal”.'),
      h('h2', {}, 'Install it'),
      h('p', {}, 'In your browser menu choose “Add to Home screen”. It then opens like an app and works offline.'),
      h('h2', {}, 'Privacy'),
      h('p', {}, 'Videos are processed on your phone and never uploaded.'),
    ),
  );
}

homeScreen();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
