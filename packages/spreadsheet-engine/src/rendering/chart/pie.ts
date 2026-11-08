import { SsconvertError, type CapabilityContext } from "../../contracts.js";

/** Resolved single-ring allocation. Radius fitting, outlines, styles and labels
 * are deliberately outside this wedge stage, as in gog_pie_view_render.
 */
export interface PieGeometryRequest {
  readonly values: readonly number[];
  readonly negativeMode: "skip" | "absolute" | "white";
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  readonly innerRadius: number;
  /** Combined plot/series initial angle in degrees. */
  readonly initialAngle: number;
  /** Plot span in percent of a full circle. */
  readonly span: number;
  /** Default separation as a fraction of total radius, outer ring only. */
  readonly separation: number;
  /** Resolved per-element separation overrides for the outer ring. */
  readonly elementSeparation?: ReadonlyMap<number, number>;
}
export interface PieWedge {
  readonly index: number;
  readonly whiteFill: boolean;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  readonly innerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

/** GOffice 0.10.61 gog_pie_series_update and wedge loop, codec independent. */
export function* pieWedges(request: PieGeometryRequest, context: CapabilityContext): Generator<PieWedge> {
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  function charge() {
    context.signal.throwIfAborted();
    if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert chart work limit exceeded");
  }
  charge();
  let total = 0;
  // The native total is accumulated in reverse data order.
  for (let index = request.values.length; index-- > 0;) {
    charge();
    const value = request.values[index]!;
    if (Number.isFinite(value)) total += value < 0 ? request.negativeMode === "skip" ? 0 : -value : value;
  }
  const scale = 2 * Math.PI / 100 * request.span / total;
  let theta = request.initialAngle * Math.PI / 180 - Math.PI / 2;
  const defaultSeparation = request.radius * request.separation;
  for (let index = 0; index < request.values.length; index++) {
    charge();
    let length = request.values[index]! * scale;
    const negative = length < 0;
    if (negative) {
      if (request.negativeMode === "skip") continue;
      length = -length;
    }
    if (!Number.isFinite(length) || length < 1e-3) continue;
    const override = request.elementSeparation?.get(index);
    let centerX = request.centerX, centerY = request.centerY;
    if (defaultSeparation > 0 || override !== undefined) {
      const separation = defaultSeparation + (override ?? 0) * request.radius;
      centerX += separation * Math.cos(theta + length / 2);
      centerY += separation * Math.sin(theta + length / 2);
    }
    theta += length;
    yield { index, whiteFill: negative && request.negativeMode === "white", centerX, centerY,
      radius: request.radius, innerRadius: request.innerRadius > 0 ? request.innerRadius : 0,
      startAngle: theta - length, endAngle: theta };
  }
  context.signal.throwIfAborted();
}
