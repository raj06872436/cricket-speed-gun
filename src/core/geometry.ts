export interface Pt {
  x: number;
  y: number;
}

/** A measurement line in image space, from point `a` to point `b`. */
export interface Line {
  a: Pt;
  b: Pt;
}

export const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y });
export const dot = (p: Pt, q: Pt): number => p.x * q.x + p.y * q.y;
export const cross = (p: Pt, q: Pt): number => p.x * q.y - p.y * q.x;
export const len = (p: Pt): number => Math.hypot(p.x, p.y);
export const mid = (l: Line): Pt => ({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 });

/** Signed perpendicular distance from `p` to the infinite line through `l`. */
export function signedDist(l: Line, p: Pt): number {
  const d = sub(l.b, l.a);
  const n = len(d) || 1;
  return cross(d, sub(p, l.a)) / n;
}

/**
 * Two measurement lines oriented so that distances are positive in the direction of
 * travel: `fromA(p)` > 0 once the ball has passed line A, `fromB(p)` > 0 once it has passed B.
 */
export class Gate {
  private sA: number;
  private sB: number;
  /** Unit vector along the direction of travel (from A towards B). */
  readonly axis: Pt;
  /** Pixel distance between the two lines along the direction of travel. */
  readonly spanPx: number;

  constructor(readonly A: Line, readonly B: Line) {
    const mA = mid(A);
    const mB = mid(B);
    this.sA = Math.sign(signedDist(A, mB)) || 1;
    this.sB = -(Math.sign(signedDist(B, mA)) || 1);
    const ax = sub(mB, mA);
    const n = len(ax) || 1;
    this.axis = { x: ax.x / n, y: ax.y / n };
    this.spanPx = Math.abs(signedDist(A, mB) + signedDist(B, mA)) / 2 || n;
  }

  fromA(p: Pt): number {
    return this.sA * signedDist(this.A, p);
  }

  fromB(p: Pt): number {
    return this.sB * signedDist(this.B, p);
  }

  /** Fraction of the way from line A to line B (0 at A, 1 at B). */
  frac(p: Pt): number {
    const a = this.fromA(p);
    const b = this.fromB(p);
    const tot = a - b;
    return tot === 0 ? 0 : a / tot;
  }

  /** Coordinate along the direction of travel, in px. */
  along(p: Pt): number {
    return dot(p, this.axis);
  }

  /** Coordinate perpendicular to the direction of travel, in px. */
  across(p: Pt): number {
    return cross(this.axis, p);
  }
}

/** Builds a line through `p` that is vertical in the image, `h` px tall. */
export function verticalLine(p: Pt, h = 100): Line {
  return { a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y - h } };
}
