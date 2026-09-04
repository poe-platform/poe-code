import { yieldTurn } from "../contracts/yield.js";
import { nextCodePointOffset, stringCheckpoint } from "./string-operations.js";
import type { StringWork } from "./string-operations.js";
type PatternToken = { kind: "star" } | { kind: "any" } | { kind: "literal"; value: string } | { kind: "class"; expression: RegExp };

const characterClasses: Readonly<Record<string, string>> = {
  alnum: "a-zA-Z0-9", alpha: "a-zA-Z", ascii: "\\x00-\\x7f", blank: " \\t",
  cntrl: "\\x00-\\x1f\\x7f", digit: "0-9", graph: "\\x21-\\x7e", lower: "a-z",
  print: "\\x20-\\x7e", punct: "\\x21-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e",
  space: " \\t\\r\\n\\v\\f", upper: "A-Z", word: "a-zA-Z0-9_", xdigit: "a-fA-F0-9",
};

async function tokens(pattern: string, work: StringWork): Promise<PatternToken[]> {
  const admission = stringCheckpoint(work, pattern.length);
  if (admission) await admission;
  work.allocation?.reserve(128 + pattern.length * 64, 0);
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
  return result;
}

export async function compilePattern(pattern: string, work: StringWork): Promise<(value: string, start?: number, end?: number) => Promise<boolean>> {
  work.signal.throwIfAborted();
  const patternTokens = await tokens(pattern, work);
  return (value, start = 0, end = value.length) => matchTokens(patternTokens, value, work, start, end);
}

export async function matchesPattern(pattern: string, value: string, work: StringWork): Promise<boolean> {
  return (await compilePattern(pattern, work))(value);
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
