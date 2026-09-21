import type { AxisMap } from "./axis.js";

export interface ErrorBarData {
  readonly type: "none" | "absolute" | "relative" | "percent";
  /** Resolved valid series vector; absent/error entries are NaN. */
  readonly values: readonly number[];
  readonly positive?: readonly number[];
  readonly negative?: readonly number[];
}
export interface ErrorBarBounds {
  readonly minus: number;
  readonly plus: number;
}

/** gog_error_bar_get_bounds, GOffice 0.10.61. Invalid errors are -1
 * before relative/percent scaling, which can turn the sentinel into -0.
 */
export function errorBarBounds(data: ErrorBarData, index: number): ErrorBarBounds | undefined {
  if (index < 0 || !Number.isInteger(index)) return undefined;
  const value = data.values[index];
  if (data.type === "none" || value === undefined || !Number.isFinite(value)) return undefined;
  const positive = data.positive, negative = data.negative;
  let plus = positive?.[positive.length === 1 ? 0 : index] ?? -1;
  let minus = negative === undefined || negative.length === 0 ? plus : negative[negative.length === 1 ? 0 : index] ?? -1;
  if (!Number.isFinite(minus) || minus <= 0) minus = -1;
  if (!Number.isFinite(plus) || plus <= 0) plus = -1;
  if (data.type === "relative" || data.type === "percent") {
    const scale = data.type === "relative" ? Math.abs(value) : Math.abs(value) / 100;
    minus *= scale;
    plus *= scale;
  }
  return { minus, plus };
}

export interface CartesianErrorBarRequest extends ErrorBarBounds {
  readonly x: number;
  readonly y: number;
  readonly direction: "horizontal" | "vertical";
  readonly display: "none" | "positive" | "negative" | "both";
  readonly xMap: AxisMap;
  readonly yMap: AxisMap;
  /** Widths in points; renderer scale is explicit, with no host discovery. */
  readonly capWidth: number;
  readonly lineWidth: number;
  readonly pointsToX: number;
  readonly pointsToY: number;
}
export interface ChartSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Cartesian branch of gog_error_bar_render. Clipping/paint is downstream;
 * no clipping to axis bounds occurs here. Polar bars require another mapping.
 */
export function cartesianErrorBarSegments(request: CartesianErrorBarRequest): readonly ChartSegment[] {
  if (request.direction !== "horizontal" && request.direction !== "vertical") return [];
  const { x, y, minus, plus, xMap, yMap } = request;
  const start = plus > 0 && (request.display === "positive" || request.display === "both");
  const end = minus > 0 && (request.display === "negative" || request.display === "both");
  if (!start && !end) return [];
  const horizontal = request.direction === "horizontal";
  const map = horizontal ? xMap : yMap, value = horizontal ? x : y;
  if (!xMap.isFinite(x) || !yMap.isFinite(y)
    || (start && !map.isFinite(value + plus)) || (end && !map.isFinite(value - minus))) return [];
  const xView = xMap.toView(x), yView = yMap.toView(y);
  const first = map.toView(start ? value + plus : value);
  const last = map.toView(end ? value - minus : value);
  const segments: ChartSegment[] = [horizontal
    ? { x1: first, y1: yView, x2: last, y2: yView }
    : { x1: xView, y1: first, x2: xView, y2: last }];
  const width = request.capWidth * (horizontal ? request.pointsToY : request.pointsToX) / 2;
  const lineWidth = request.lineWidth * (horizontal ? request.pointsToX : request.pointsToY);
  if (2 * width > lineWidth) {
    if (start) segments.push(horizontal
      ? { x1: first, y1: yView - width, x2: first, y2: yView + width }
      : { x1: xView - width, y1: first, x2: xView + width, y2: first });
    if (end) segments.push(horizontal
      ? { x1: last, y1: yView - width, x2: last, y2: yView + width }
      : { x1: xView - width, y1: last, x2: xView + width, y2: last });
  }
  return segments;
}
