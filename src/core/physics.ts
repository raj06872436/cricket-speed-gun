/**
 * Ball-flight physics used to turn a measured flight time into a speed.
 *
 * A speed gun reports the speed at release. Between release and the batter the
 * ball slows down through air drag and loses more speed when it bounces, so the
 * plain average speed over the measured distance is lower than the release speed.
 * We model drag as dv/ds = -k·v (quadratic drag expressed per metre travelled) and
 * the bounce as an instant loss of horizontal speed.
 */

/** Air density (kg/m³), drag coefficient, cross-section (m²) and mass (kg) of a cricket ball. */
const RHO = 1.2;
const CD = 0.45;
const AREA = Math.PI * 0.036 * 0.036;
const MASS = 0.1563;

/** Drag constant k (1/m): v(s) = v0 · e^(−k·s). */
export const DEFAULT_DRAG_K = (RHO * CD * AREA) / (2 * MASS);

/** Fraction of horizontal speed kept through the bounce. */
export const DEFAULT_BOUNCE_RETENTION = 0.9;

/** Standard pitch positions, metres from the bowler's stumps. */
export const PITCH = {
  bowlerStumps: 0,
  bowlerCrease: 1.22,
  batterCrease: 20.12 - 1.22,
  batterStumps: 20.12,
} as const;

export interface FlightInput {
  /** Distance between the two lines in metres. */
  distance: number;
  /** Measured time for the ball to travel between the lines, in seconds. */
  time: number;
  /** Distance from line A to the bounce point (m), if the ball bounced between the lines. */
  bounceAt?: number;
  dragK?: number;
  bounceRetention?: number;
}

export interface SpeedResult {
  /** Average speed between the lines (m/s). */
  average: number;
  /** Estimated speed at line A, i.e. at release (m/s). */
  release: number;
  /** Estimated speed when the ball reaches line B (m/s). */
  arrival: number;
}

export function computeSpeed(input: FlightInput): SpeedResult {
  const { distance: D, time: t } = input;
  if (!(D > 0) || !(t > 0)) throw new Error('Distance and time must be positive');
  const k = input.dragK ?? DEFAULT_DRAG_K;
  const c = input.bounceRetention ?? DEFAULT_BOUNCE_RETENTION;
  const average = D / t;
  if (k <= 0) {
    return { average, release: average, arrival: average };
  }
  const sb = input.bounceAt;
  let release: number;
  let arrival: number;
  if (sb !== undefined && sb > 0 && sb < D) {
    // t = [ (e^{k·sb} − 1) + (e^{k·D} − e^{k·sb}) / c ] / (k·v0)
    release = (Math.expm1(k * sb) + (Math.exp(k * D) - Math.exp(k * sb)) / c) / (k * t);
    arrival = release * c * Math.exp(-k * D);
  } else {
    // t = (e^{k·D} − 1) / (k·v0)
    release = Math.expm1(k * D) / (k * t);
    arrival = release * Math.exp(-k * D);
  }
  return { average, release, arrival };
}

export const toKmh = (mps: number): number => mps * 3.6;
export const toMph = (mps: number): number => mps * 2.2369362920544;

/**
 * Speed uncertainty from timing uncertainty: |dv| ≈ v · dt / t.
 * `timingError` is the 1-sigma error on the total measured time (s).
 */
export function speedError(speed: number, time: number, timingError: number): number {
  return (speed * timingError) / time;
}
