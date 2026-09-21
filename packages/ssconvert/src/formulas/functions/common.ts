import { SsconvertError } from "../../contracts.js";
import type { CellValue } from "../../workbook.js";
import { numeric, rendered } from "../values.js";
import type { FunctionHost, Matrix, Value } from "./types.js";

export const bool = (value: boolean): CellValue => ({ kind: "boolean", value });
export const str = (value: string): CellValue => ({ kind: "string", value });
export function asBoolean(value: CellValue): boolean | undefined {
  if (value.kind === "string") {
    const s = value.value.toLowerCase();
    return s === "true" ? true : s === "false" ? false : undefined;
  }
  const n = numeric(value);
  return n === undefined ? undefined : n !== 0;
}
export function scalarArg(args: readonly (Value | undefined)[], index: number, host: FunctionHost): CellValue {
  return host.scalar(args[index] ?? { kind: "blank" });
}
export function numberArg(args: readonly (Value | undefined)[], index: number, host: FunctionHost, fallback = 0): number {
  return args[index] === undefined ? fallback : numeric(host.scalar(args[index]!)) ?? NaN;
}
export function textArg(args: readonly (Value | undefined)[], index: number, host: FunctionHost): string {
  return rendered(scalarArg(args, index, host));
}
export function collect(value: Value, host: FunctionHost, result: CellValue[] = []): CellValue[] {
  if (value.kind === "set") { for (const child of value.values) collect(child, host, result); }
  else for (const row of host.matrix(value).rows) for (const cell of row) {
    host.tick();
    if (result.length >= host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
    result.push(cell);
  }
  return result;
}
export function admitMatrix(rows: readonly (readonly CellValue[])[], host: FunctionHost): Matrix {
  if (rows.length * (rows[0]?.length ?? 0) > host.context.limits.cells)
    throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
  return { kind: "matrix", rows };
}
export function boundedText(value: string, host: Pick<FunctionHost, "context">): CellValue {
  if (value.length > host.context.limits.outputBytes || new TextEncoder().encode(value).length > host.context.limits.outputBytes)
    throw new SsconvertError("resource-limit", "ssconvert calculation text limit exceeded");
  return str(value);
}
/** Excel wildcards, with a bounded dynamic-programming matcher rather than a regex. */
export function wildcard(pattern: string, source: string, host: Pick<FunctionHost, "tick">, whole = true): boolean {
  const input = Array.from(source.toLowerCase()), tokens: { value: string; literal: boolean }[] = [];
  const chars = Array.from(pattern.toLowerCase());
  for (let i = 0; i < chars.length; i++) {
    host.tick();
    if (chars[i] === "~" && i + 1 < chars.length && ["*", "?", "~"].includes(chars[i + 1]!)) tokens.push({ value: chars[++i]!, literal: true });
    else tokens.push({ value: chars[i]!, literal: false });
  }
  let previous = Array.from({ length: input.length + 1 }, (_, index) => index === 0);
  for (const token of tokens) {
    const next = Array.from({ length: input.length + 1 }, () => false);
    next[0] = !token.literal && token.value === "*" && previous[0]!;
    for (let i = 1; i <= input.length; i++) {
      host.tick();
      next[i] = !token.literal && token.value === "*" ? previous[i]! || next[i - 1]! : previous[i - 1]! && (!token.literal && token.value === "?" || token.value === input[i - 1]);
    }
    previous = next;
  }
  return whole ? previous[input.length]! : previous.some(Boolean);
}
export function unsupported(feature: string): never {
  throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: ${feature}`);
}
