import type {AdapterContext} from "./types.js";
import {PandocError} from "./errors.js";

/** Convert authored raster dimensions to the integer EMUs used by Office formats. */
export function imageLength(value: string | undefined, natural: number, context: AdapterContext, format: string): number {
  if (value === undefined) return natural;
  const units: Record<string, number> = {in: 914400, pt: 12700, cm: 360000, mm: 36000, px: 9525};
  const unit = Object.keys(units).find(unit => value.endsWith(unit));
  const number = unit ? Number(value.slice(0, -unit.length)) : NaN;
  const result = unit ? Math.round(number * units[unit]!) : NaN;
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new PandocError("E_OPTION", context.operation ?? "write", "Image dimensions require positive in, pt, cm, mm or px values", format);
  return result;
}
