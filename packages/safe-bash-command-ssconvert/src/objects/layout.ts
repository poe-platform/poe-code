import type { SheetObject } from "./index.js";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
export interface AxisPosition { readonly start: number; readonly size: number }
export interface ObjectMetrics {
  column(index: number): AxisPosition;
  row(index: number): AxisPosition;
}
export interface ObjectRectangle { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** Gnumeric sheet_object_anchor_to_pts endpoint geometry; metrics are explicit host inputs. */
export function objectRectangle(object: SheetObject, metrics: ObjectMetrics, context: CapabilityContext): ObjectRectangle {
  context.signal.throwIfAborted();
  const { offsets, range, mode } = object.anchor;
  const invalid = () => { throw new SsconvertError("invalid-request", "Invalid sheet object geometry"); };
  if (offsets.length !== 4 || !offsets.every(Number.isFinite)) return invalid();
  const [left, top, right, bottom] = offsets as readonly [number, number, number, number];
  const absolute = mode === "absolute" || mode === "2";
  const twoCells = mode === "two-cells" || mode === "0";
  if (!absolute && !twoCells && mode !== "one-cell" && mode !== "1") return invalid();
  const endpoint = (axis: "column" | "row", index: number, fraction: number) => {
    context.signal.throwIfAborted();
    if (!Number.isSafeInteger(index) || index < 0) return invalid();
    const position = metrics[axis](index);
    context.signal.throwIfAborted();
    if (!Number.isFinite(position.start) || !Number.isFinite(position.size) || position.size < 0) return invalid();
    return position.start + fraction * position.size;
  };
  if (!absolute && !range) return invalid();
  const x = absolute ? left : endpoint("column", range!.startColumn, left);
  const y = absolute ? top : endpoint("row", range!.startRow, top);
  const width = twoCells ? endpoint("column", range!.endColumn, right) - x : right;
  const height = twoCells ? endpoint("row", range!.endRow, bottom) - y : bottom;
  if (![x, y, width, height].every(Number.isFinite)) return invalid();
  context.signal.throwIfAborted();
  return { x, y, width, height };
}
