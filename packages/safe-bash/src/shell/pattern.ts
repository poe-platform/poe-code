import { yieldTurn } from "../contracts/yield.js";
type PatternToken = { kind: "star" } | { kind: "any" } | { kind: "literal"; value: string } | { kind: "class"; expression: RegExp };

const characterClasses: Readonly<Record<string, string>> = {
  alnum: "a-zA-Z0-9", alpha: "a-zA-Z", ascii: "\\x00-\\x7f", blank: " \\t",
  cntrl: "\\x00-\\x1f\\x7f", digit: "0-9", graph: "\\x21-\\x7e", lower: "a-z",
  print: "\\x20-\\x7e", punct: "\\x21-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e",
  space: " \\t\\r\\n\\v\\f", upper: "A-Z", word: "a-zA-Z0-9_", xdigit: "a-fA-F0-9",
};

interface PatternWork { remaining: number; signal: AbortSignal; exhausted(): never }

async function tokens(pattern: string, work: PatternWork): Promise<PatternToken[]> {
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

export async function compilePattern(pattern: string, work: PatternWork): Promise<(value: string) => Promise<boolean>> {
  work.signal.throwIfAborted();
  const patternTokens = await tokens(pattern, work);
  return (value) => matchTokens(patternTokens, value, work);
}

export async function matchesPattern(pattern: string, value: string, work: PatternWork): Promise<boolean> {
  return (await compilePattern(pattern, work))(value);
}

async function matchTokens(patternTokens: PatternToken[], value: string, work: PatternWork): Promise<boolean> {
  work.signal.throwIfAborted();
  const characters = Array.from(value);
  let position = 0;
  let tokenIndex = 0;
  let star = -1;
  let retry = 0;
  let steps = 0;
  while (position < characters.length) {
    if (--work.remaining < 0) work.exhausted();
    if (++steps % 1024 === 0) {
      await yieldTurn(work.signal);
      work.signal.throwIfAborted();
    }
    const token = patternTokens[tokenIndex];
    if (token?.kind === "star") { star = tokenIndex++; retry = position; }
    else if (token && (token.kind === "any" || (token.kind === "literal" ? token.value === characters[position] : token.expression.test(characters[position]!)))) {
      position++;
      tokenIndex++;
    } else if (star !== -1) { tokenIndex = star + 1; position = ++retry; }
    else return false;
  }
  while (patternTokens[tokenIndex]?.kind === "star") tokenIndex++;
  return tokenIndex === patternTokens.length;
}
