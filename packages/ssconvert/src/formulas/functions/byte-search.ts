// Gnumeric1.12.61 SEARCH/SEARCHB: bounded byte cursors and caseless UTF-8 wildcards.
// GPL-2.0-or-later; see the package LICENSE.
import { readByteTextCharacter } from "../../encoding/byte-text.js";
import { foldSheetName } from "../../workbook/case-fold.js";

function decode(source: Uint8Array, tick: () => void): string | undefined {
  for (let index = 0; index < source.length; index++) tick();
  try { return new TextDecoder("UTF-8", { fatal: true, ignoreBOM: true }).decode(source); }
  catch (error) { if (!(error instanceof TypeError)) throw error; return undefined; }
}

function fold(character: string): string {
  const folded = foldSheetName(character);
  if (Array.from(folded).length === 1) return folded;
  // Regex caseless matching never expands one character into several. Retain
  // simple lowercase counterparts (including capital sharp S), without turning
  // dotted I into the two-character full fold or matching ordinary I.
  const lower = character.toLowerCase();
  return Array.from(lower).length === 1 ? lower : character;
}

function match(pattern: string, input: readonly string[], tick: () => void): number | undefined {
  const chars = Array.from(pattern), tokens: { value: string; literal: boolean }[] = [];
  for (let index = 0; index < chars.length; index++) {
    tick();
    const escaped = chars[index] === "~" && ["*", "?", "~"].includes(chars[index + 1] ?? "");
    tokens.push({ value: fold(chars[escaped ? ++index : index]!), literal: escaped });
  }
  const folded = input.map(character => { tick(); return fold(character); });
  // Each position starts a possible unanchored match. Carry its earliest start
  // through the wildcard automaton, using O(input length) memory.
  let previous = input.map((_character, index) => index);
  previous.push(input.length);
  for (const token of tokens) {
    const next: number[] = [];
    const star = !token.literal && token.value === "*", any = !token.literal && token.value === "?";
    next[0] = star ? previous[0]! : Infinity;
    for (let index = 1; index <= input.length; index++) {
      tick();
      // GRegex's default newline convention is ANY, with DOTALL disabled.
      const dot = !["\n", "\r", "\v", "\f", "\u0085", "\u2028", "\u2029"].includes(input[index - 1]!);
      next[index] = star ? Math.min(previous[index]!, dot ? next[index - 1]! : Infinity)
        : (any ? dot : token.value === folded[index - 1]) ? previous[index - 1]! : Infinity;
    }
    previous = next;
  }
  let result = Infinity;
  for (const start of previous) { tick(); result = Math.min(result, start); }
  return result === Infinity ? undefined : result;
}

export function searchByteText(needle: Uint8Array, source: Uint8Array, start: number, bytes: boolean, tick: () => void): number | undefined {
  tick();
  if (Number.isNaN(start) || start < 1 || (bytes ? start > source.length : start >= 2147483647)) return undefined;
  const skip = Math.trunc(start) - 1;
  let from = bytes ? skip : 0;
  if (!bytes) for (let index = 0; index < skip; index++) {
    tick();
    if (from >= source.length) return undefined;
    from = readByteTextCharacter(source, from, tick).next;
  }
  const pattern = decode(needle, tick), tail = decode(source.subarray(from), tick);
  if (pattern === undefined || tail === undefined) return undefined;
  const chars = Array.from(tail), found = match(pattern, chars, tick);
  if (found === undefined) return undefined;
  if (!bytes) return skip + found + 1;
  let offset = from;
  for (let index = 0; index < found; index++) { tick(); offset += new TextEncoder().encode(chars[index]!).length; }
  return offset + 1;
}
