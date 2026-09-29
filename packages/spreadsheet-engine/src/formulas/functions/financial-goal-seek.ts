import type { FunctionHost } from "./types.js";

/** Deterministic Gnumeric 1.12.61 goal-seek state and financial search policies. */
export class FinancialGoalSeek {
  private positive?: { x: number; y: number };
  private negative?: { x: number; y: number };
  root = NaN;
  constructor(private readonly f: (x: number) => number, private readonly host: Pick<FunctionHost, "tick">,
    readonly minimum: number, readonly maximum: number, private readonly derivative?: (x: number) => number) {}
  get bracketed(): boolean { return this.positive !== undefined && this.negative !== undefined; }
  private evaluate(x: number): number { this.host.tick(); return this.f(x); }
  private update(x: number, y: number): boolean {
    if (!Number.isFinite(y)) return false;
    if (y === 0) { this.root = x; return true; }
    const current = y > 0 ? this.positive : this.negative;
    const other = y > 0 ? this.negative : this.positive;
    if (!current || (other ? Math.abs(x - other.x) < Math.abs(current.x - other.x) : Math.abs(y) < Math.abs(current.y))) {
      if (y > 0) this.positive = { x, y }; else this.negative = { x, y };
    }
    return false;
  }
  point(x: number): boolean {
    if (!Number.isNaN(this.root)) return true;
    if (x < this.minimum || x > this.maximum) return false;
    return this.update(x, this.evaluate(x));
  }
  private slope(x: number, step: number): number {
    const left = x - step < this.minimum ? x : x - step, right = x + step > this.maximum ? x : x + step;
    if (left === right) return NaN;
    const leftY = this.evaluate(left);
    if (Number.isNaN(leftY)) return NaN;
    const rightY = this.evaluate(right);
    return (rightY - leftY) / (right - left);
  }
  newton(x: number): boolean {
    if (!Number.isNaN(this.root)) return true;
    let lastSlope = 1, stepFactor = 1e-6;
    for (let i = 0; i < 100; i++) {
      if (x < this.minimum || x > this.maximum) return false;
      const y = this.evaluate(x);
      if (Number.isNaN(y)) return false;
      if (this.update(x, y)) return true;
      const step = Math.abs(x) < 1e-10 ? (this.bracketed ? Math.abs(this.positive!.x - this.negative!.x) : this.maximum - this.minimum) / 1e6 : stepFactor * Math.abs(x);
      let slope = this.derivative ? this.derivative(x) : this.slope(x, step);
      if (!Number.isFinite(slope)) return false;
      const flat = slope === 0;
      if (flat) { lastSlope /= 2; if (Math.abs(lastSlope) <= 2.2250738585072014e-308) return false; slope = lastSlope; }
      else lastSlope = slope;
      const next = x - (this.bracketed ? 1 : 1.000001) * y / slope;
      const size = Math.abs(next - x) / (Math.abs(x) + Math.abs(next));
      if (size < 5e-11) return this.polish(x, y);
      if (flat && i > 0) {
        if (next < this.minimum || next > this.maximum) return false;
        const nextY = this.evaluate(next);
        if (Number.isNaN(nextY) || Math.abs(nextY) >= .9 * Math.abs(y)) return false;
      }
      if (size < stepFactor) stepFactor = size;
      x = next;
    }
    return false;
  }
  private polish(x: number, y: number): boolean {
    let lastSlope = 1, square = x !== 0 && Math.abs(x) < 1e10, newton = true;
    for (let i = 0; i < 20; i++) {
      if (square) {
        const next = x * Math.abs(x), nextY = this.evaluate(next);
        if (this.update(next, nextY)) return true;
        const ratio = Math.abs(nextY / y);
        if (!Number.isNaN(nextY) && ratio < 1) { x = next; if (ratio <= .5) continue; }
        square = false;
      }
      if (newton) {
        let slope = this.derivative ? this.derivative(x) : this.slope(x, Math.abs(x) / 1e6);
        if (!Number.isFinite(slope) || slope === 0) slope = lastSlope; else lastSlope = slope;
        const next = x - y / slope;
        if (next >= this.minimum && next <= this.maximum) {
          const nextY = this.evaluate(next);
          if (this.update(next, nextY)) return true;
          const ratio = Math.abs(nextY / y);
          if (!Number.isNaN(nextY) && ratio < 1) { x = next; if (ratio <= .5) continue; }
        }
        newton = false;
      }
      break;
    }
    if (this.bisect()) return true;
    this.root = x; return true;
  }
  bisect(): boolean {
    if (!Number.isNaN(this.root)) return true;
    if (!this.bracketed) return false;
    let size = Math.abs(this.positive!.x - this.negative!.x) / (Math.abs(this.positive!.x) + Math.abs(this.negative!.x)), submethod = 0;
    for (let i = 0; i < 160; i++) {
      const pos = this.positive!, neg = this.negative!;
      let mid = (pos.x + neg.x) / 2;
      if (i % 4 === 0) {
        const y = this.evaluate(mid);
        if (Number.isNaN(y)) continue;
        if (y === 0) return this.update(mid, y);
        const determinant = Math.sqrt(y * y - pos.y * neg.y);
        if (determinant === 0) continue;
        mid += (mid - pos.x) * y / determinant;
      } else if (i % 4 === 2 && size <= .1) {
        const method = submethod++ % 4;
        const x = method === 0 ? pos.x : method === 2 ? neg.x : mid;
        const y = method === 0 ? pos.y : method === 2 ? neg.y : this.evaluate(x);
        const slope = this.slope(x, Math.abs(pos.x - neg.x) / 1e6);
        if (!Number.isFinite(slope) || slope === 0 || Number.isNaN(y)) continue;
        mid = x - 1.01 * y / slope;
      }
      if (mid < Math.min(pos.x, neg.x) || mid > Math.max(pos.x, neg.x)) mid = (pos.x + neg.x) / 2;
      const y = this.evaluate(mid);
      if (Number.isNaN(y)) continue;
      if (this.update(mid, y)) return true;
      size = Math.abs(this.positive!.x - this.negative!.x) / (Math.abs(this.positive!.x) + Math.abs(this.negative!.x));
      if (size < Number.EPSILON) {
        let rootY = y, rootX = mid;
        if (this.negative!.y < rootY) { rootY = this.negative!.y; rootX = this.negative!.x; }
        if (this.positive!.y < rootY) rootX = this.positive!.x;
        this.root = rootX; return true;
      }
    }
    return false;
  }
}
