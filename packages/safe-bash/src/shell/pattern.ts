import { yieldTurn } from "../contracts/yield.js";
import type { ValueReservation } from "../contracts/value.js";
import { nextCodePointOffset, previousCodePointOffset, stringCheckpoint } from "./string-operations.js";
import type { StringWork } from "./string-operations.js";
type PatternToken = { kind: "star" } | { kind: "any" } | { kind: "literal"; value: string } | { kind: "class"; expression: RegExp };

const characterClasses: Readonly<Record<string, string>> = {
  alnum: "a-zA-Z0-9", alpha: "a-zA-Z", ascii: "\\x00-\\x7f", blank: " \\t",
  cntrl: "\\x00-\\x1f\\x7f", digit: "0-9", graph: "\\x21-\\x7e", lower: "a-z",
  print: "\\x20-\\x7e", punct: "\\x21-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e",
  space: " \\t\\r\\n\\v\\f", upper: "A-Z", word: "a-zA-Z0-9_", xdigit: "a-fA-F0-9",
};

async function tokens(pattern: string, work: StringWork): Promise<{ patternTokens: PatternToken[]; reservation: ValueReservation | undefined }> {
  const admission = stringCheckpoint(work, pattern.length);
  if (admission) await admission;
  const reservation = work.allocation?.reserve(128 + pattern.length * 64, 0);
  const result: PatternToken[] = [];
  const characters = Array.from(pattern);
  const lastClosingBracket = characters.lastIndexOf("]");
  let steps = 0;
  const tick = (): Promise<void> | undefined => {
    if (--work.remaining < 0) work.exhausted();
    if (++steps % 1024 === 0) return yieldTurn(work.signal);
    return undefined;
  };
  for (let index = 0; index < characters.length; index++) {
    const pending = tick();
    if (pending) await pending;
    const character = characters[index]!;
    if (character === "\\" && index + 1 < characters.length) result.push({ kind: "literal", value: characters[++index]! });
    else if (character === "*") {
      if (result.at(-1)?.kind !== "star") result.push({ kind: "star" });
    } else if (character === "?") result.push({ kind: "any" });
    else if (character === "[" && index < lastClosingBracket) {
      let cursor = index + 1;
      let contents = "";
      if (["!", "^"].includes(characters[cursor] ?? "")) { contents = "^"; cursor++; }
      if (characters[cursor] === "]") { contents += "\\]"; cursor++; }
      let valid = true;
      for (; cursor < characters.length && characters[cursor] !== "]"; cursor++) {
        const pending = tick();
        if (pending) await pending;
        const member = characters[cursor]!;
        if (member === "\\" && cursor + 1 < characters.length) {
          contents += `\\u{${characters[++cursor]!.codePointAt(0)!.toString(16)}}`;
        } else if (member === "[" && characters[cursor + 1] === ":") {
          let end = cursor + 2;
          while (end < characters.length && characters[end] !== ":" && characters[end] !== "]") {
            const pending = tick();
            if (pending) await pending;
            end++;
          }
          if (characters[end] === ":" && characters[end + 1] === "]") {
            const name = characters.slice(cursor + 2, end).join("");
            valid &&= characterClasses[name] !== undefined;
            contents += characterClasses[name] ?? "";
            cursor = end + 1;
          } else contents += "\\[";
        } else contents += member === "[" || member === "^" ? `\\${member}` : member;
      }
      if (cursor < characters.length && cursor > index + 1) {
        let expression: RegExp;
        try { expression = valid ? new RegExp(`^[${contents}](?![\\s\\S])`, "u") : /(?!)/u; }
        catch { expression = /(?!)/u; }
        result.push({ kind: "class", expression });
        index = cursor;
      } else result.push({ kind: "literal", value: character });
    } else result.push({ kind: "literal", value: character });
  }
  return { patternTokens: result, reservation };
}

export async function compilePattern(pattern: string, work: StringWork): Promise<(value: string, start?: number, end?: number) => Promise<boolean>> {
  work.signal.throwIfAborted();
  const { patternTokens } = await tokens(pattern, work);
  return (value, start = 0, end = value.length) => matchTokens(patternTokens, value, work, start, end);
}

export async function matchesPattern(pattern: string, value: string, work: StringWork): Promise<boolean> {
  const { patternTokens, reservation } = await tokens(pattern, work);
  try { return await matchTokens(patternTokens, value, work, 0, value.length); }
  finally { reservation?.release(); }
}

export async function compilePatternBoundaries(pattern: string, work: StringWork): Promise<(value: string, shortest?: boolean, suffix?: boolean) => Promise<Float64Array>> {
  work.signal.throwIfAborted();
  const { patternTokens } = await tokens(pattern, work);
  return async (value, shortest = false, suffix = false) => {
    let rowReservation: ValueReservation | undefined;
    let resultReservation: ValueReservation | undefined;
    try {
      const rowSize = patternTokens.length + 1;
      const resultSize = value.length + 1;
      const initialized = stringCheckpoint(work, rowSize + resultSize);
      if (initialized) await initialized;
      rowReservation = work.allocation?.reserve(64 + rowSize * 8, 0);
      resultReservation = work.allocation?.reserve(64 + resultSize * 8, 0);
      const row = new Float64Array(rowSize).fill(-1);
      const ends = new Float64Array(resultSize).fill(-1);
      let position = value.length;
      while (true) {
        const advanced = stringCheckpoint(work);
        if (advanced) await advanced;
        const point = position < value.length ? value.codePointAt(position)! : undefined;
        let diagonal = row[patternTokens.length]!;
        row[patternTokens.length] = !suffix || position === value.length ? position : -1;
        for (let index = patternTokens.length - 1; index >= 0; index--) {
          const pending = stringCheckpoint(work);
          if (pending) await pending;
          const previous = row[index]!;
          const token = patternTokens[index]!;
          if (token.kind === "star") {
            const skip = row[index + 1]!;
            const consume = point === undefined ? -1 : previous;
            row[index] = skip < 0 ? consume : consume < 0 ? skip : shortest ? Math.min(skip, consume) : Math.max(skip, consume);
          } else {
            const accepts = point !== undefined && (token.kind === "any" || (token.kind === "literal" ? token.value.codePointAt(0) === point : token.expression.test(String.fromCodePoint(point))));
            row[index] = accepts ? diagonal : -1;
          }
          diagonal = previous;
        }
        ends[position] = row[0]!;
        if (position === 0) break;
        position = previousCodePointOffset(value, position);
      }
      work.signal.throwIfAborted();
      return ends;
    } catch (error) {
      resultReservation?.release();
      throw error;
    } finally { rowReservation?.release(); }
  };
}

async function matchTokens(patternTokens: PatternToken[], value: string, work: StringWork, start: number, end: number): Promise<boolean> {
  work.signal.throwIfAborted();
  let position = start;
  let tokenIndex = 0;
  let star = -1;
  let retry = start;
  while (position < end) {
    const pending = stringCheckpoint(work);
    if (pending) await pending;
    work.signal.throwIfAborted();
    const token = patternTokens[tokenIndex];
    const point = value.codePointAt(position)!;
    if (token?.kind === "star") { star = tokenIndex++; retry = position; }
    else if (token && (token.kind === "any" || (token.kind === "literal" ? token.value.codePointAt(0) === point : token.expression.test(String.fromCodePoint(point))))) {
      position += point > 0xffff ? 2 : 1;
      tokenIndex++;
    } else if (star !== -1) { tokenIndex = star + 1; retry = nextCodePointOffset(value, retry); position = retry; }
    else return false;
  }
  work.signal.throwIfAborted();
  while (patternTokens[tokenIndex]?.kind === "star") tokenIndex++;
  return tokenIndex === patternTokens.length;
}
