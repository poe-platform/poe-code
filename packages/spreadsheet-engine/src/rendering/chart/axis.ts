/** Explicit-bound GogAxisMap behavior from GOffice 0.10.61 gog-axis.c.
 * Date/time formats select other bound/tick algorithms, not other transforms.
 * Bounds and spans must already have been resolved by the chart model.
 */
export interface AxisMapRequest {
  readonly scale: "linear" | "category" | "logarithmic";
  readonly minimum: number;
  readonly maximum: number;
  readonly offset: number;
  readonly length: number;
  readonly inverted?: boolean;
  readonly circular?: boolean;
  readonly spanStart?: number;
  readonly spanEnd?: number;
}

export interface AxisMap {
  readonly valid: boolean;
  normalized(value: number): number;
  toView(value: number): number;
  fromView(value: number): number;
  derivative(value: number): number;
  isFinite(value: number): boolean;
  baseline(): number;
  bounds(): readonly [number, number];
}

// go_rint uses the default nearest-even rounding mode, unlike Math.round.
function nearestEven(value: number): number {
  const lower = Math.floor(value), fraction = value - lower;
  const rounded = fraction < 0.5 ? lower : fraction > 0.5 ? lower + 1 : lower % 2 === 0 ? lower : lower + 1;
  return rounded === 0 && value < 0 ? -0 : rounded;
}

export function createAxisMap(request: AxisMapRequest): AxisMap {
  const log = request.scale === "logarithmic", category = request.scale === "category";
  const inverted = request.inverted ?? false;
  let offset = request.offset, length = request.length;
  if (!request.circular) {
    offset += (request.spanStart ?? 0) * length;
    length *= (request.spanEnd ?? 1) - (request.spanStart ?? 0);
  }
  const valid = Number.isFinite(request.minimum) && Number.isFinite(request.maximum)
    && request.minimum < request.maximum && (!log || request.minimum > 0);
  const min = valid ? (log ? Math.log(request.minimum) : request.minimum) : 0;
  const max = valid ? (log ? Math.log(request.maximum) : request.maximum) : log ? Math.log(10) : 1;
  const scale = 1 / (max - min), a = scale * length;
  const b = valid && (log || category) ? offset - a * min : offset;
  const aInv = -scale * length, bInv = valid ? offset + length - aInv * min : offset + length;
  function toView(value: number): number {
    if (log) {
      if (value <= 0) return inverted ? -Number.MAX_VALUE : Number.MAX_VALUE;
      return inverted ? Math.log(value) * aInv + bInv : Math.log(value) * a + b;
    }
    if (category) return (inverted ? min + max - value : value) * a + b;
    return (inverted ? max - value : value - min) * a + b;
  }
  return Object.freeze({
    valid,
    normalized(value: number) {
      const mapped = ((log ? Math.log(value) : value) - min) * scale;
      return inverted ? 1 - mapped : mapped;
    },
    toView,
    fromView(value: number) {
      if (log) return inverted ? Math.exp((value - bInv) / aInv) : Math.exp((value - b) / a);
      if (category) return nearestEven(inverted ? min + max - (value - b) / a : (value - b) / a);
      return inverted ? max - (value - b) / a : (value - b) / a + min;
    },
    derivative(value: number) {
      if (log) return value <= 0 ? NaN : (inverted ? aInv : a) / value;
      return inverted ? -a : a;
    },
    isFinite(value: number) { return Number.isFinite(value) && (!log || value > 0); },
    baseline() {
      if (log) return inverted ? min * aInv + bInv : min * a + b;
      // GOffice also uses map_linear_to_view for a discrete baseline.
      const value = min > 0 ? min : max < 0 ? max : 0;
      return (inverted ? max - value : value - min) * a + b;
    },
    bounds(): readonly [number, number] { return log ? [Math.exp(min), Math.exp(max)] : [min, max]; }
  });
}
