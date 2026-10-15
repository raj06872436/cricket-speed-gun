import { h } from './dom';
import { store, Delivery } from './store';
import { conv, downloadText, unitLabel } from './format';
import { speedChart, pitchMap } from './charts';
import type { Analysis } from '../core/analysis';
import { DEFAULT_DRAG_K } from '../core/physics';

/** Physics model settings from the user's preferences. */
export function model() {
  const s = store.settings();
  return { dragK: (DEFAULT_DRAG_K * s.cd) / 0.45, bounceRetention: s.bounceRetention / 100 };
}

export function confidenceText(a: Analysis, unit: string, c: (v: number) => number): string {
  const pm = `±${c(a.error).toFixed(1)} ${unit}`;
  return a.confidence === 'high' ? `Accurate (${pm})` : a.confidence === 'medium' ? `Good estimate (${pm})` : `Rough estimate (${pm})`;
}

/** Adds a measured ball to the history and returns its id. */
export function saveDelivery(a: Analysis, fps: number, mode: Delivery['mode'] = a.mode): string {
  const d: Delivery = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    date: Date.now(),
    bowler: store.settings().bowler,
    release: a.speed.release,
    average: a.speed.average,
    error: a.error,
    confidence: a.confidence,
    length: a.bounce?.length,
    bounceFromStumps: a.bounce?.fromBatterStumps,
    mode,
    fps,
  };
  store.addDelivery(d);
  return d.id;
}

export interface DetailsContext {
  posA: number;
  posB: number;
  fps: number;
  slowMo?: boolean;
  live?: boolean;
}

/** Stats table, speed chart, pitch map, CSV export and an explanation for one delivery. */
export function detailsContent(a: Analysis, ctx: DetailsContext, extra: (HTMLElement | null)[] = []): HTMLElement[] {
  const s = store.settings();
  const u = unitLabel(s.unit);
  const c = conv(s.unit);
  const sp = (v: number) => `${c(v).toFixed(1)} ${u}`;
  const rows: [string, string][] = [
    ['Out of the hand', sp(a.speed.release)],
    ['Average speed', sp(a.speed.average)],
    ['Reaching the batter', sp(a.speed.arrival)],
    ['Time between lines', `${(a.time * 1000).toFixed(0)} ms`],
    ['Distance measured', `${a.distance.toFixed(2)} m`],
    ['Accuracy', `±${c(a.error).toFixed(1)} ${u}`],
    ['Frame rate', `${ctx.fps} fps${ctx.slowMo ? ' (slow-mo)' : ctx.live ? ' (live)' : ''}`],
    [
      'Method',
      a.mode === 'manual'
        ? 'Frames picked by hand'
        : `${ctx.live ? 'Live' : 'Auto'} (${a.track.length} ball positions${a.methodA === 'extrapolated' || a.methodB === 'extrapolated' ? ', path extended' : ''})`,
    ],
  ];
  if (a.bounce) {
    rows.splice(3, 0, ['Length', a.bounce.length], ['Pitched (from stumps)', `${a.bounce.fromBatterStumps.toFixed(1)} m`]);
  }
  const table = h('dl.stats', {}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  const m = model();
  const modelFn = (pos: number) => {
    const d = pos - ctx.posA;
    const bounced = a.bounce && d > a.bounce.fromA;
    return a.speed.release * Math.exp(-m.dragK * d) * (bounced ? m.bounceRetention : 1);
  };
  const chartBlock =
    a.samples.length > 1 || a.mode === 'manual'
      ? h(
          'figure',
          {},
          h('figcaption', {}, 'Speed down the pitch'),
          speedChart({ samples: a.samples, model: modelFn, posA: ctx.posA, posB: ctx.posB, bounceAt: a.bounce ? a.bounce.fromA + ctx.posA : undefined, conv: c, unit: u }),
          h('p.hint', {}, a.samples.length ? 'Dots: measured from the video. Line: physics model (air drag and bounce).' : 'Line: physics model (air drag and bounce).'),
        )
      : null;
  const mapBlock = a.bounce ? h('figure', {}, h('figcaption', {}, 'Where it pitched'), pitchMap(a.bounce)) : null;

  const csv = h(
    'button.ghost.small',
    {
      type: 'button',
      onclick: () => {
        const lines = [
          `# Cricket Speed Gun export`,
          `release_${s.unit},${c(a.speed.release).toFixed(2)}`,
          `average_${s.unit},${c(a.speed.average).toFixed(2)}`,
          `time_s,${a.time.toFixed(5)}`,
          `distance_m,${a.distance}`,
          `fps,${ctx.fps}`,
          '',
          't_s,x_px,y_px',
          ...a.track.map((p) => `${p.t.toFixed(5)},${p.x.toFixed(1)},${p.y.toFixed(1)}`),
        ];
        downloadText(`delivery-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, lines.join('\n'));
      },
    },
    'Download data (CSV)',
  );

  return [
    table,
    ...([chartBlock, mapBlock, ...extra].filter(Boolean) as HTMLElement[]),
    h('div.row.wrap', {}, csv),
    h(
      'details.explain',
      {},
      h('summary', {}, 'How is this worked out?'),
      h(
        'p',
        {},
        'The app finds the ball in every frame and works out, to a fraction of a frame, when it crosses each of your two lines. Distance ÷ time gives the average speed. Like a TV speed gun, the headline number is the speed out of the bowler’s hand: the ball slows down through the air and loses more speed when it bounces, so we add that back using standard cricket ball physics.',
      ),
    ),
  ];
}
