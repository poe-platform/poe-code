import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import type { AxisMetadata } from "../../workbook.js";

export interface PrintBreak { readonly position: number; readonly type: "manual" | "auto" | "none" | "data-slice" }
export interface AxisPrintRequest {
  readonly start: number;
  readonly end: number;
  readonly usablePoints: number;
  readonly defaultSizePoints: number;
  readonly items?: readonly AxisMetadata[];
  readonly repeat?: { readonly start: number; readonly end: number };
  readonly breaks?: readonly PrintBreak[];
}
export interface AxisPrintPage {
  readonly start: number;
  readonly end: number;
  readonly repeatStart: number;
  readonly repeatCount: number;
  readonly sizePoints: number;
  readonly repeatPoints: number;
}
export function printWork(context: CapabilityContext): (amount?: number) => void {
  context.signal.throwIfAborted();
  let work = 0;
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes * 8 + context.limits.cells * 32;
  if (!Number.isSafeInteger(maximum) || maximum < 0)
    throw new SsconvertError("invalid-request", "Invalid ssconvert print work budget");
  return (amount = 1) => {
    context.signal.throwIfAborted();
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new SsconvertError("invalid-request", "Invalid ssconvert print work amount");
    if (amount > maximum - work)
      throw new SsconvertError("resource-limit", "ssconvert print work limit exceeded");
    work += amount;
  };
}
/** Gnumeric print.c compute_group/adjust_repetition/paginate; all sizes are points. */
export function paginateAxis(request: AxisPrintRequest, context: CapabilityContext): readonly AxisPrintPage[] {
  return axisPaginator(request, printWork(context)).paginate(request.usablePoints);
}
export function axisPaginator(request: AxisPrintRequest, tick: (amount?: number) => void) {
  tick();
  function index(value: number) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new SsconvertError("invalid-request", "Invalid ssconvert print axis index");
  }
  index(request.start); index(request.end);
  if (request.end < request.start || !Number.isFinite(request.usablePoints) ||
      !Number.isFinite(request.defaultSizePoints) || request.defaultSizePoints < 0)
    throw new SsconvertError("invalid-request", "Invalid ssconvert print axis geometry");
  if (request.repeat) {
    index(request.repeat.start); index(request.repeat.end);
    if (request.repeat.end < request.repeat.start)
      throw new SsconvertError("invalid-request", "Reversed ssconvert print titles");
  }
  const sizes = new Map<number, number>();
  const hidden = new Set<number>();
  for (const item of request.items ?? []) {
    tick(); index(item.index);
    const points = item.sizePoints ?? request.defaultSizePoints;
    if (!Number.isFinite(points) || points < 0 || sizes.has(item.index))
      throw new SsconvertError("invalid-request", "Invalid ssconvert print axis metadata");
    sizes.set(item.index, item.hidden ? 0 : points);
    if (item.hidden) hidden.add(item.index);
  }
  const breaks = new Set<number>();
  for (const entry of request.breaks ?? []) {
    tick(); index(entry.position);
    if (!["manual", "auto", "none", "data-slice"].includes(entry.type))
      throw new SsconvertError("invalid-request", "Invalid ssconvert print page break");
    if (entry.type === "manual" || entry.type === "data-slice") breaks.add(entry.position);
  }
  function distance(start: number, end: number) {
    let points = 0;
    for (let i = start; i <= end; i++) { tick(); points += sizes.get(i) ?? request.defaultSizePoints; }
    if (!Number.isFinite(points)) throw new SsconvertError("invalid-request", "Invalid ssconvert print axis extent");
    return points;
  }
  function paginate(usable: number): readonly AxisPrintPage[] {
    tick();
    const pages: AxisPrintPage[] = [];
    let start = request.start;
    while (start <= request.end) {
      tick();
      const repeatStart = request.repeat && start > request.repeat.start ? request.repeat.start : 0;
      const repeatCount = request.repeat && start > request.repeat.start ?
        Math.min(start - request.repeat.start, request.repeat.end - request.repeat.start + 1) : 0;
      const repeatPoints = distance(repeatStart, repeatStart + repeatCount - 1);
      let end = start - 1, sizePoints = 0;
      for (let i = start; i <= request.end; i++) {
        tick();
        if (i > start && breaks.has(i)) break;
        const size = sizes.get(i) ?? request.defaultSizePoints;
        if (!hidden.has(i) && 1 + sizePoints + size > usable - repeatPoints && i > start) break;
        sizePoints += size; end = i;
        if (!hidden.has(i) && 1 + sizePoints > usable - repeatPoints) break;
      }
      pages.push({ start, end, repeatStart, repeatCount, sizePoints, repeatPoints });
      start = end + 1;
    }
    return pages;
  }
  /** Matches compute_scale_fit_to, including the single-page two-point allowance. */
  function fit(pages: number, usable: number, header: number, maximum = 1) {
    tick();
    if (!Number.isSafeInteger(pages) || pages < 0 || !Number.isFinite(usable) || usable <= 0 ||
      !Number.isFinite(header) || header < 0 || !Number.isFinite(maximum) || maximum <= 0)
      throw new SsconvertError("invalid-request", "Invalid ssconvert print fit geometry");
    if (pages === 0) return maximum;
    let extent = distance(request.start, request.end);
    if (request.repeat && request.repeat.start < request.start)
      extent += distance(request.repeat.start, Math.min(request.repeat.end, request.start - 1));
    if (pages === 1) return Math.min(maximum, usable / (header + extent + 2));
    const clamp = (value: number) => Math.min(maximum, Math.max(0.01, value));
    let high = clamp(pages * usable / (extent + pages * header));
    if (paginate(usable / high - header).length === pages) return high;
    let low = clamp(usable / (extent + header));
    while (high - low > 0.001) {
      tick(); const middle = (high + low) / 2;
      if (paginate(usable / middle - header).length > pages) high = middle;
      else low = middle;
    }
    return low;
  }
  return { paginate, fit, distance };
}
