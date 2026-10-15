import type { Line, Pt } from '../core/geometry';

export interface StageTrackPoint extends Pt {
  t: number;
}

export interface StageLine {
  base: Pt;
  top: Pt;
}

const COLORS = ['#ffd23f', '#3fd0ff'];
const LABELS = ['1', '2'];

/**
 * Canvas showing the current video frame with measurement lines, the ball track and
 * markers. In edit mode the user taps to place lines and drags their handles.
 */
export class Stage {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  lines: (StageLine | null)[] = [null, null];
  lineNames = ['Bowler’s crease', 'Batter’s stumps'];
  track: StageTrackPoint[] = [];
  /** Show track points up to this real time (undefined = all). */
  trackUntil?: number;
  bounce?: Pt;
  editable = false;
  /** When not editable, tapping toggles a magnified view centred on the tap. */
  zoomable = true;
  private zoom: { x: number; y: number; f: number } | null = null;
  onChange?: () => void;
  private drag: { line: number; handle: 'base' | 'top'; pointer: Pt } | null = null;

  constructor(private video: HTMLVideoElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage';
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', () => this.up());
    this.canvas.addEventListener('pointercancel', () => this.up());
  }

  get W(): number {
    return this.video.videoWidth || 640;
  }
  get H(): number {
    return this.video.videoHeight || 360;
  }

  /** Index of the next line to place, or -1 once both are placed. */
  get nextLine(): number {
    return this.lines.findIndex((l) => !l);
  }

  measurementLines(): [Line, Line] | null {
    const [a, b] = this.lines;
    if (!a || !b) return null;
    return [
      { a: a.base, b: a.top },
      { a: b.base, b: b.top },
    ];
  }

  setLines(lines: [Line, Line] | null): void {
    this.lines = lines ? lines.map((l) => ({ base: { ...l.a }, top: { ...l.b } })) : [null, null];
    this.render();
  }

  private scale(): number {
    const r = this.canvas.getBoundingClientRect();
    return r.width ? this.W / r.width : 1;
  }

  private toVideo(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.W, y: ((e.clientY - r.top) / r.height) * this.H };
  }

  /** Visible source rectangle (video px) given the current zoom. */
  private view(): { sx: number; sy: number; f: number } {
    if (!this.zoom) return { sx: 0, sy: 0, f: 1 };
    const { f } = this.zoom;
    const sw = this.W / f;
    const sh = this.H / f;
    const sx = Math.max(0, Math.min(this.W - sw, this.zoom.x - sw / 2));
    const sy = Math.max(0, Math.min(this.H - sh, this.zoom.y - sh / 2));
    return { sx, sy, f };
  }

  private down(e: PointerEvent): void {
    if (!this.editable) {
      if (!this.zoomable) return;
      const p = this.toVideo(e);
      const v = this.view();
      this.zoom = this.zoom ? null : { x: v.sx + p.x / v.f, y: v.sy + p.y / v.f, f: 2.5 };
      this.render();
      return;
    }
    const p = this.toVideo(e);
    const hit = 26 * this.scale();
    let best: { line: number; handle: 'base' | 'top'; d: number } | null = null;
    this.lines.forEach((l, i) => {
      if (!l) return;
      for (const handle of ['base', 'top'] as const) {
        const d = Math.hypot(l[handle].x - p.x, l[handle].y - p.y);
        if (d < hit && (!best || d < best.d)) best = { line: i, handle, d };
      }
    });
    if (!best) {
      const i = this.nextLine;
      if (i < 0) return;
      this.lines[i] = { base: p, top: { x: p.x, y: Math.max(0, p.y - this.H * 0.3) } };
      best = { line: i, handle: 'base', d: 0 };
      this.onChange?.();
    }
    const b = best as { line: number; handle: 'base' | 'top' };
    this.drag = { line: b.line, handle: b.handle, pointer: p };
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.render();
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
    const p = this.toVideo(e);
    const l = this.lines[this.drag.line]!;
    const dx = p.x - this.drag.pointer.x;
    const dy = p.y - this.drag.pointer.y;
    if (this.drag.handle === 'base') {
      // Moving the base drags the whole line, keeping its tilt.
      l.base = { x: l.base.x + dx, y: l.base.y + dy };
      l.top = { x: l.top.x + dx, y: l.top.y + dy };
    } else {
      l.top = { x: l.top.x + dx, y: l.top.y + dy };
    }
    this.drag.pointer = p;
    this.render();
  }

  private up(): void {
    if (!this.drag) return;
    this.drag = null;
    this.render();
    this.onChange?.();
  }

  render(): void {
    const { W, H, ctx } = this;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const view = this.view();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.video.readyState >= 2) ctx.drawImage(this.video, view.sx, view.sy, W / view.f, H / view.f, 0, 0, W, H);
    else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.setTransform(view.f, 0, 0, view.f, -view.sx * view.f, -view.sy * view.f);
    const u = Math.max(1.5, W / 420) / view.f;
    // Track
    const pts = this.trackUntil === undefined ? this.track : this.track.filter((p) => p.t <= this.trackUntil!);
    if (pts.length) {
      ctx.lineWidth = u;
      ctx.strokeStyle = 'rgba(255,80,80,0.85)';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.fillStyle = '#ff5050';
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, u * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (this.bounce) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = u;
      ctx.beginPath();
      ctx.arc(this.bounce.x, this.bounce.y, u * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Lines, extended across the frame
    this.lines.forEach((l, i) => {
      if (!l) return;
      const dx = l.top.x - l.base.x;
      const dy = l.top.y - l.base.y;
      const n = Math.hypot(dx, dy) || 1;
      const ext = Math.max(W, H) * 2;
      ctx.save();
      ctx.strokeStyle = COLORS[i];
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = u;
      ctx.setLineDash([u * 5, u * 4]);
      ctx.beginPath();
      ctx.moveTo(l.base.x - (dx / n) * ext, l.base.y - (dy / n) * ext);
      ctx.lineTo(l.base.x + (dx / n) * ext, l.base.y + (dy / n) * ext);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineWidth = u * 2;
      ctx.beginPath();
      ctx.moveTo(l.base.x, l.base.y);
      ctx.lineTo(l.top.x, l.top.y);
      ctx.stroke();
      if (this.editable) {
        // Handles
        for (const p of [l.base, l.top]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, u * 7, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fill();
          ctx.stroke();
        }
      }
      // Label
      const fs = Math.round(u * 11);
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      const text = `${LABELS[i]}  ${this.lineNames[i]}`;
      const tw = ctx.measureText(text).width;
      const lx = Math.min(W - tw - u * 8, Math.max(u * 2, l.base.x - tw / 2));
      const ly = Math.min(H - u * 4, l.base.y + fs + u * 10);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(lx - u * 4, ly - fs, tw + u * 8, fs + u * 6);
      ctx.fillStyle = COLORS[i];
      ctx.fillText(text, lx, ly);
      ctx.restore();
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.drag) this.drawLoupe(this.drag.pointer, u);
    if (this.zoomable && !this.editable) {
      const fs = Math.round(Math.max(1.5, W / 420) * 10);
      const label = this.zoom ? 'Tap to zoom out' : 'Tap to zoom in';
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(W - tw - fs * 1.6, fs * 0.6, tw + fs, fs * 1.6);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, W - tw - fs * 1.1, fs * 1.75);
    }
  }

  /** Magnified view of the area under the finger, drawn in the opposite top corner. */
  private drawLoupe(p: Pt, u: number): void {
    const { ctx, W, H } = this;
    const r = Math.min(W, H) * 0.17;
    const zoom = 3;
    const cx = p.x < W / 2 ? W - r - u * 6 : r + u * 6;
    const cy = r + u * 6;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const src = r / zoom;
    if (this.video.readyState >= 2) {
      ctx.drawImage(this.video, p.x - src, p.y - src, src * 2, src * 2, cx - r, cy - r, r * 2, r * 2);
    }
    // Show the line being dragged inside the loupe too.
    const l = this.drag && this.lines[this.drag.line];
    if (l) {
      const tx = (q: Pt) => ({ x: cx + (q.x - p.x) * zoom, y: cy + (q.y - p.y) * zoom });
      const a = tx(l.base);
      const b = tx(l.top);
      ctx.strokeStyle = COLORS[this.drag!.line];
      ctx.lineWidth = u * 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = u;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = u * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}
