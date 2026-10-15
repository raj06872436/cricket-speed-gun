import { toKmh, toMph } from '../core/physics';
import type { Unit } from './store';

export const unitLabel = (u: Unit): string => (u === 'kmh' ? 'km/h' : 'mph');
export const conv = (u: Unit) => (mps: number): number => (u === 'kmh' ? toKmh(mps) : toMph(mps));
export const fmtSpeed = (mps: number, u: Unit, digits = 0): string => conv(u)(mps).toFixed(digits);
export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function downloadText(name: string, text: string, type = 'text/csv'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
