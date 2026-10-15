import { DEFAULT_BOUNCE_RETENTION } from '../core/physics';
import type { Line } from '../core/geometry';

export type Unit = 'kmh' | 'mph';
export type Headline = 'release' | 'average';

export interface Settings {
  unit: Unit;
  headline: Headline;
  /** Drag coefficient of the ball. */
  cd: number;
  /** Percentage of horizontal speed kept after the bounce. */
  bounceRetention: number;
  bowler: string;
  seenIntro: boolean;
}

export interface Delivery {
  id: string;
  date: number;
  bowler: string;
  /** m/s */
  release: number;
  average: number;
  error: number;
  confidence: string;
  length?: string;
  bounceFromStumps?: number;
  mode: 'auto' | 'manual';
  fps: number;
}

export interface SavedLines {
  lineA: Line;
  lineB: Line;
  videoW: number;
  videoH: number;
  posA: number;
  posB: number;
}

const DEFAULTS: Settings = {
  unit: 'kmh',
  headline: 'release',
  cd: 0.45,
  bounceRetention: Math.round(DEFAULT_BOUNCE_RETENTION * 100),
  bowler: '',
  seenIntro: false,
};

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export const store = {
  settings(): Settings {
    return { ...DEFAULTS, ...read<Partial<Settings>>('csg.settings', {}) };
  },
  saveSettings(s: Partial<Settings>): Settings {
    const next = { ...store.settings(), ...s };
    write('csg.settings', next);
    return next;
  },
  history(): Delivery[] {
    return read<Delivery[]>('csg.history', []);
  },
  addDelivery(d: Delivery): void {
    write('csg.history', [d, ...store.history()].slice(0, 500));
  },
  updateDelivery(id: string, patch: Partial<Delivery>): void {
    write(
      'csg.history',
      store.history().map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  },
  removeDelivery(id: string): void {
    write(
      'csg.history',
      store.history().filter((d) => d.id !== id),
    );
  },
  clearHistory(): void {
    write('csg.history', []);
  },
  lines(): SavedLines | null {
    return read<SavedLines | null>('csg.lines', null);
  },
  saveLines(l: SavedLines): void {
    write('csg.lines', l);
  },
};
