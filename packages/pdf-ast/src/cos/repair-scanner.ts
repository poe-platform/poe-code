import { isPdfDelimiter, isPdfWhitespace } from "./lexer.js";

type Request = { kind: "byte"; offset: number } | { kind: "object" | "trailer"; offset: number };
type Work<T> = Generator<Request, T, number | undefined>;
const digit = (byte: number | undefined): boolean => byte !== undefined && byte >= 48 && byte <= 57;
function* byte(offset: number): Work<number | undefined> { return yield { kind: "byte", offset }; }
function* matches(offset: number, text: string): Work<boolean> {
  for (let i = 0; i < text.length; i++) if ((yield* byte(offset + i)) !== text.charCodeAt(i)) return false;
  return true;
}

/** Locate repair candidates with constant scanner state. Drivers parse a
 * candidate and return its end offset so stream payloads are never rescanned. */
export function* repairCandidateSteps(size: number): Work<void> {
  let pos = 0;
  while (pos < size) {
    while (pos < size && !digit(yield* byte(pos))) {
      const current = yield* byte(pos);
      if (current === 37) {
        while (pos < size) { const ch = yield* byte(pos); if (ch === 10 || ch === 13) break; pos++; }
        continue;
      }
      if (current === 116 && (pos === 0 || isPdfWhitespace((yield* byte(pos - 1))!)) && (yield* matches(pos, "trailer"))) {
        const after = yield* byte(pos + 7);
        if (after === undefined || isPdfWhitespace(after) || isPdfDelimiter(after)) {
          const end = yield { kind: "trailer", offset: pos + 7 };
          if (end !== undefined && end > pos) { pos = end; continue; }
        }
      }
      pos++;
    }
    if (pos >= size) break;
    if (pos > 0 && !isPdfWhitespace((yield* byte(pos - 1))!)) {
      while (pos < size && !isPdfWhitespace((yield* byte(pos))!)) pos++;
      continue;
    }
    const start = pos;
    while (pos < size && digit(yield* byte(pos))) pos++;
    if (pos >= size || !isPdfWhitespace((yield* byte(pos))!)) continue;
    while (pos < size && isPdfWhitespace((yield* byte(pos))!)) pos++;
    const generation = pos;
    while (pos < size && digit(yield* byte(pos))) pos++;
    if (pos === generation || pos >= size || !isPdfWhitespace((yield* byte(pos))!)) continue;
    while (pos < size && isPdfWhitespace((yield* byte(pos))!)) pos++;
    if (!(yield* matches(pos, "obj"))) continue;
    const after = yield* byte(pos + 3);
    if (after !== undefined && !isPdfWhitespace(after) && after !== 60 && after !== 91 && after !== 47 && after !== 40) continue;
    pos += 3;
    const end = yield { kind: "object", offset: start };
    if (end !== undefined && end > pos) pos = end;
  }
}
