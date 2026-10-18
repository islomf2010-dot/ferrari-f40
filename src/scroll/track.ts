/**
 * Hermite / Catmull-Rom track interpolation.
 *
 * The whole experience is a pure function `t -> pose`. Every channel (camera
 * position, look-at target, fov, car transform, light rig, grade) is sampled
 * from one of these tracks. That gives us, for free:
 *
 *   - C1 continuity, so nothing ever snaps between scenes;
 *   - exact reversibility, because evaluation never depends on history;
 *   - zero GSAP tween conflicts, because there is only ever one writer per
 *     property and the writer is a pure function.
 */

export type Vec3Tuple = readonly [number, number, number];

/** One-sided slope used at the two ends of a track (no neighbour to difference against). */
function edgeTangent(inside: number, outside: number, dt: number): number {
  return (outside - inside) / (dt || 1);
}

export class Track {
  readonly size: number;
  private readonly ts: number[] = [];
  private readonly vs: number[][] = [];
  private readonly tangents: number[][] = [];

  /**
   * @param tension 1 = classic Catmull-Rom. Below 1 the curve hugs the keyframes
   *                more tightly (less overshoot); 0 flattens it into a staircase.
   * @param settle  story times where the derivative is forced to zero. The
   *                experience should start and end at rest, and a hard settle
   *                also removes the tail overshoot Catmull-Rom produces after a
   *                decelerating run of keys.
   */
  tension: number;
  settle: Set<number>;

  constructor(stops: Array<{ t: number; v: number[] }>, tension = 1, settle: Iterable<number> = []) {
    this.tension = tension;
    this.settle = new Set(settle);
    if (stops.length < 2) throw new Error('Track needs at least two stops');
    const sorted = [...stops].sort((a, b) => a.t - b.t);
    this.size = sorted[0].v.length;
    if (sorted.some((s) => s.v.length !== this.size)) throw new Error('Track channels must be uniform');

    for (const s of sorted) {
      this.ts.push(s.t);
      this.vs.push(s.v);
    }

    // Catmull-Rom tangents from finite differences (non-uniform spacing).
    const n = sorted.length;
    const settled = sorted.map((s) => this.settle.has(s.t));
    for (let i = 0; i < n; i++) {
      const t: number[] = [];
      for (let c = 0; c < this.size; c++) {
        let m: number;
        if (settled[i]) m = 0;
        else if (i === 0) m = edgeTangent(sorted[0].v[c], sorted[1].v[c], sorted[1].t - sorted[0].t);
        else if (i === n - 1) m = edgeTangent(sorted[n - 1].v[c], sorted[n - 2].v[c], sorted[n - 1].t - sorted[n - 2].t);
        else m = (sorted[i + 1].v[c] - sorted[i - 1].v[c]) / (sorted[i + 1].t - sorted[i - 1].t);
        t.push(m * tension);
      }
      this.tangents.push(t);
    }
  }

  private segment(t: number): number {
    // Binary search for the last stop <= t.
    let lo = 0;
    let hi = this.ts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.ts[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Writes channel `c` at normalised progress `t` into `out`. */
  sample(t: number, c: number, out: Float32Array | number[]): number {
    const tt = Math.min(Math.max(t, 0), 1);
    const i = this.segment(tt);
    const t0 = this.ts[i];
    const t1 = this.ts[i + 1];
    const span = t1 - t0 || 1;
    const u = (tt - t0) / span;
    const u2 = u * u;
    const u3 = u2 * u;

    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;

    const p0 = this.vs[i][c];
    const p1 = this.vs[i + 1][c];
    const m0 = this.tangents[i][c];
    const m1 = this.tangents[i + 1][c];

    const value = h00 * p0 + h10 * span * m0 + h01 * p1 + h11 * span * m1;
    out[c] = value;
    return value;
  }

  /** Convenience: sample all channels into a plain array. */
  sampleAll(t: number): number[] {
    const out: number[] = [];
    for (let c = 0; c < this.size; c++) this.sample(t, c, out);
    return out;
  }
}

/**
 * Monotone piecewise-cubic (Fritsch-Carlson). Used where a channel must never
 * reverse direction — scene opacity, light ramps — so it settles instead of
 * overshooting past the intended value.
 */
export class MonotoneTrack {
  private readonly ts: number[] = [];
  private readonly vs: number[] = [];
  private readonly ms: number[] = [];

  constructor(stops: Array<{ t: number; v: number }>) {
    const s = [...stops].sort((a, b) => a.t - b.t);
    const n = s.length;
    for (const k of s) {
      this.ts.push(k.t);
      this.vs.push(k.v);
    }
    const delta: number[] = [];
    for (let i = 0; i < n - 1; i++) delta.push((s[i + 1].v - s[i].v) / (s[i + 1].t - s[i].t || 1));

    this.ms.push(delta[0]);
    for (let i = 1; i < n - 1; i++) {
      if (delta[i - 1] * delta[i] <= 0) this.ms.push(0);
      else this.ms.push((delta[i - 1] + delta[i]) / 2);
    }
    this.ms.push(delta[n - 2]);

    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) {
        this.ms[i] = 0;
        this.ms[i + 1] = 0;
        continue;
      }
      const a = this.ms[i] / delta[i];
      const b = this.ms[i + 1] / delta[i];
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        this.ms[i] = tau * a * delta[i];
        this.ms[i + 1] = tau * b * delta[i];
      }
    }
  }

  at(t: number): number {
    const tt = Math.min(Math.max(t, 0), 1);
    let i = 0;
    while (i < this.ts.length - 2 && tt > this.ts[i + 1]) i++;
    const h = this.ts[i + 1] - this.ts[i] || 1;
    const u = (tt - this.ts[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * this.vs[i] +
      (u3 - 2 * u2 + u) * h * this.ms[i] +
      (-2 * u3 + 3 * u2) * this.vs[i + 1] +
      (u3 - u2) * h * this.ms[i + 1]
    );
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

export const toVec3 = (a: ArrayLike<number>, offset = 0): Vec3Tuple => [
  a[offset],
  a[offset + 1],
  a[offset + 2],
];