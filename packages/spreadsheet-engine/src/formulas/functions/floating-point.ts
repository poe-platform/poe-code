import { error, numericResult } from "../values.js";
import { numberArg, scalarArg } from "./common.js";
import type { FunctionImplementation } from "./types.js";

/** Adjacent binary64 value; the buffer belongs to this call, never a shared realm. */
export function nextAfter(x: number, y: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === y) return y;
  if (x === 0) return y < 0 ? -Number.MIN_VALUE : Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  view.setBigUint64(0, bits + ((y > x) === (x > 0) ? 1n : -1n));
  return view.getFloat64(0);
}

/** GOffice fake rounding snaps values one representable step from an integer. */
export function fakeFloor(x: number): number { return x === Math.floor(x) ? x : Math.floor(nextAfter(x, Infinity)); }
export function fakeTrunc(x: number): number { return x < 0 ? -fakeFloor(-x) : fakeFloor(x); }

export const floatingPointFunctions: Readonly<Record<string, FunctionImplementation>> = {
  "FLT.RADIX": () => numericResult(2),
  "FLT.MIN": () => numericResult(2 ** -1022),
  "FLT.MAX": () => numericResult(Number.MAX_VALUE),
  "FLT.NEXTAFTER": (args, host) => {
    const x = numberArg(args, 0, host), direction = scalarArg(args, 1, host);
    const y = direction.kind === "string" ? direction.value === "+" ? Infinity : direction.value === "-" ? -Infinity : NaN
      : direction.kind === "number" ? direction.value : direction.kind === "boolean" ? Number(direction.value) : NaN;
    return Number.isNaN(y) ? error("#VALUE!") : numericResult(nextAfter(x, y));
  }
};
