import type { CellValue } from "../../workbook.js";
import { error, sum } from "../values.js";
import { collect } from "./common.js";
import type { FunctionHost, Value } from "./types.js";

export function statisticalNumbers(value: Value, host: FunctionHost, includeText = false, ignoreErrors = false): number[] | CellValue {
  const result: number[] = [];
  for (const cell of collect(value, host)) {
    if (cell.kind === "error") { if (!ignoreErrors) return cell; }
    else if (cell.kind === "number") result.push(cell.value);
    else if (includeText && cell.kind !== "blank") result.push(cell.kind === "boolean" ? Number(cell.value) : 0);
  }
  return result;
}
export function statisticalPairs(a: Value, b: Value, host: FunctionHost): [number[], number[]] | CellValue {
  const x = collect(a, host), y = collect(b, host), xs: number[] = [], ys: number[] = [];
  if (x.length !== y.length) return error("#N/A");
  for (let i = 0; i < x.length; i++) {
    host.tick(); const left = x[i]!, right = y[i]!;
    if (left.kind === "error") return left;
    if (right.kind === "error") return right;
    if (left.kind === "number" && right.kind === "number") { xs.push(left.value); ys.push(right.value); }
  }
  return [xs, ys];
}
export function statisticalMean(xs: readonly number[], host: FunctionHost): number {
  if (!xs.length) return NaN;
  if (xs.every(x => x === xs[0])) return xs[0]!;
  return sum(xs, host.tick) / xs.length;
}
export function statisticalSort(xs: number[], host: FunctionHost): number[] {
  return xs.sort((a, b) => { host.tick(); return a - b; });
}
export function quantile(xs: readonly number[], probability: number, exclusive: boolean): number {
  const index = exclusive ? probability * (xs.length + 1) - 1 : probability * (xs.length - 1);
  if (!xs.length || probability < 0 || probability > 1 || index < 0 || index > xs.length - 1) return NaN;
  const lower = Math.floor(index), fraction = index - lower;
  return fraction === 0 ? xs[lower]! : xs[lower]! * (1 - fraction) + xs[lower + 1]! * fraction;
}
