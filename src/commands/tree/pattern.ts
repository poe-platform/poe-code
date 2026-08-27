import { UsageError, type WalkBudget } from "./io.js";

type Token = number | "*" | "?" | { readonly negate: boolean; readonly ranges: readonly (readonly [number, number])[] };
export type Pattern = readonly (readonly Token[])[];

export function compile(pattern: string): Pattern {
  if (pattern.includes("/") || pattern.includes("**")) throw new UsageError("path patterns and ** are not supported; use basename patterns");
  const bytes = new TextEncoder().encode(pattern);
  const alternatives: Token[][] = [[]];
  let tokens = alternatives[0]!;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    if (byte === 124) { tokens = []; alternatives.push(tokens); }
    else if (byte === 42) tokens.push("*");
    else if (byte === 63) tokens.push("?");
    else if (byte === 92) {
      if (++index === bytes.length) throw new UsageError("trailing backslash in pattern");
      tokens.push(bytes[index]!);
    } else if (byte === 91) {
      index++;
      const negate = bytes[index] === 94 || bytes[index] === 33;
      if (negate) index++;
      const ranges: [number, number][] = [];
      while (index < bytes.length && (bytes[index] !== 93 || ranges.length === 0)) {
        const start = bytes[index++]!;
        let end = start;
        if (bytes[index] === 45 && bytes[index + 1] !== 93 && index + 1 < bytes.length) {
          end = bytes[index + 1]!; index += 2;
        }
        if (end < start) throw new UsageError("descending range in pattern");
        ranges.push([start, end]);
      }
      if (bytes[index] !== 93 || ranges.length === 0) throw new UsageError("unclosed or empty bracket pattern");
      tokens.push({ negate, ranges });
    } else tokens.push(byte);
  }
  return alternatives;
}

export function matches(pattern: Pattern, name: Uint8Array, budget: WalkBudget): boolean {
  for (const tokens of pattern) {
    let previous = new Uint8Array(name.length + 1);
    previous[0] = 1;
    for (const token of tokens) {
      budget.step(name.length + 1);
      const next = new Uint8Array(name.length + 1);
      if (token === "*") next[0] = previous[0]!;
      for (let index = 1; index <= name.length; index++) {
        const byte = name[index - 1]!;
        if (token === "*") next[index] = previous[index]! || next[index - 1]!;
        else if (previous[index - 1]) {
          if (typeof token === "object") {
            budget.step(token.ranges.length);
            const contained = token.ranges.some(([start, end]) => byte >= start && byte <= end);
            next[index] = Number(contained !== token.negate);
          } else next[index] = Number(token === "?" || token === byte);
        }
      }
      previous = next;
    }
    if (previous[name.length]) return true;
  }
  return false;
}
