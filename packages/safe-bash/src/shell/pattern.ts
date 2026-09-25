import { yieldTurn } from "../contracts/yield.js";
import type { ValueReservation } from "../contracts/value.js";
import { nextCodePointOffset, previousCodePointOffset, stringCheckpoint } from "./string-operations.js";
import type { StringWork } from "./string-operations.js";
type ExtglobOperator = "?" | "*" | "+" | "@" | "!";
type PatternToken =
  | { kind: "star" }
  | { kind: "any" }
  | { kind: "literal"; value: string }
  | { kind: "class"; expression: RegExp }
  | { kind: "extglob"; operator: ExtglobOperator; branches: PatternToken[][] };

const characterClasses: Readonly<Record<string, string>> = {
  alnum: "a-zA-Z0-9", alpha: "a-zA-Z", ascii: "\\x00-\\x7f", blank: " \\t",
  cntrl: "\\x00-\\x1f\\x7f", digit: "0-9", graph: "\\x21-\\x7e", lower: "a-z",
  print: "\\x20-\\x7e", punct: "\\x21-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e",
  space: " \\t\\r\\n\\v\\f", upper: "A-Z", word: "a-zA-Z0-9_", xdigit: "a-fA-F0-9",
};

function findExtglobClose(characters: readonly string[], openParenIndex: number): { closeIndex: number; splits: number[] } | undefined {
  let depth = 1;
  let inBracket = false;
  let bracketStart = -1;
  const splits: number[] = [];
  for (let cursor = openParenIndex + 1; cursor < characters.length; cursor++) {
    const ch = characters[cursor]!;
    if (ch === "\\" && cursor + 1 < characters.length) {
      cursor++;
      continue;
    }
    if (inBracket) {
      if (ch === "[" && characters[cursor + 1] === ":") {
        let end = cursor + 2;
        while (end + 1 < characters.length && !(characters[end] === ":" && characters[end + 1] === "]")) end++;
        if (end + 1 < characters.length) cursor = end + 1;
      } else if (ch === "]" && cursor > bracketStart + 1) {
        inBracket = false;
      }
    } else {
      if (ch === "[") {
        inBracket = true;
        bracketStart = cursor + (["!", "^"].includes(characters[cursor + 1] ?? "") ? 1 : 0);
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
        if (depth === 0) return { closeIndex: cursor, splits };
      } else if (ch === "|" && depth === 1) {
        splits.push(cursor);
      }
    }
  }
  return undefined;
}

function hasExtglobTokens(patternTokens: readonly PatternToken[]): boolean {
  return patternTokens.some(t => t.kind === "extglob");
}

async function tokens(pattern: string, work: StringWork, ignoreCase = false, extglob = false, reserveTop = true): Promise<{ patternTokens: PatternToken[]; reservation: ValueReservation | undefined }> {
  const admission = stringCheckpoint(work, pattern.length);
  if (admission) await admission;
  const reservation = reserveTop ? work.allocation?.reserve(128 + pattern.length * 64, 0) : undefined;
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
    else if (extglob && "?*+@!".includes(character) && characters[index + 1] === "(") {
      const closed = findExtglobClose(characters, index + 1);
      if (closed) {
        const branches: PatternToken[][] = [];
        let start = index + 2;
        for (const splitIndex of [...closed.splits, closed.closeIndex]) {
          const subPattern = characters.slice(start, splitIndex).join("");
          const sub = await tokens(subPattern, work, ignoreCase, true, false);
          branches.push(sub.patternTokens);
          start = splitIndex + 1;
        }
        result.push({ kind: "extglob", operator: character as ExtglobOperator, branches });
        index = closed.closeIndex;
        continue;
      }
      if (character === "*") {
        if (result.at(-1)?.kind !== "star") result.push({ kind: "star" });
      } else if (character === "?") result.push({ kind: "any" });
      else result.push({ kind: "literal", value: character });
    }
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
        try { expression = valid ? new RegExp(`^[${contents}](?![\\s\\S])`, ignoreCase ? "iu" : "u") : /(?!)/u; }
        catch { expression = /(?!)/u; }
        result.push({ kind: "class", expression });
        index = cursor;
      } else result.push({ kind: "literal", value: character });
    } else result.push({ kind: "literal", value: character });
  }
  return { patternTokens: result, reservation };
}

function acceptsSingleChar(token: Exclude<PatternToken, { kind: "star" | "extglob" }>, ch: string, ignoreCase: boolean): boolean {
  if (token.kind === "any") return true;
  if (token.kind === "literal") {
    return token.value === ch || (ignoreCase && token.value.toLowerCase() === ch.toLowerCase());
  }
  return token.expression.test(ch);
}

function createExtglobEvaluator(chars: readonly string[], work: StringWork, ignoreCase: boolean) {
  const N = chars.length;
  const branchMemo = new Map<PatternToken, Map<number, Uint8Array>>();

  const chargeStep = (amount = 1): void => {
    work.signal.throwIfAborted();
    work.remaining -= amount;
    if (work.remaining < 0) work.exhausted();
  };

  const unionBranchesAt = (token: Extract<PatternToken, { kind: "extglob" }>, p: number): Uint8Array => {
    let byPos = branchMemo.get(token);
    if (!byPos) {
      byPos = new Map();
      branchMemo.set(token, byPos);
    }
    const cached = byPos.get(p);
    if (cached) return cached;
    const union = new Uint8Array(N + 1);
    for (const branch of token.branches) {
      const branchReach = allEnds(branch, p);
      for (let q = p; q <= N; q++) {
        if (branchReach[q]) union[q] = 1;
      }
    }
    byPos.set(p, union);
    return union;
  };

  const allEnds = (seq: readonly PatternToken[], startCp: number): Uint8Array => {
    chargeStep(seq.length + 1);
    let cur = new Uint8Array(N + 1);
    cur[startCp] = 1;
    for (let tIdx = 0; tIdx < seq.length; tIdx++) {
      const token = seq[tIdx]!;
      const next = new Uint8Array(N + 1);
      if (token.kind === "star") {
        let seen = 0;
        for (let p = startCp; p <= N; p++) {
          if (cur[p]) seen = 1;
          if (seen) next[p] = 1;
        }
      } else if (token.kind === "extglob") {
        for (let p = startCp; p <= N; p++) {
          if (!cur[p]) continue;
          chargeStep(N - p + 1);
          const u = unionBranchesAt(token, p);
          if (token.operator === "@") {
            for (let q = p; q <= N; q++) if (u[q]) next[q] = 1;
          } else if (token.operator === "?") {
            next[p] = 1;
            for (let q = p; q <= N; q++) if (u[q]) next[q] = 1;
          } else if (token.operator === "+" || token.operator === "*") {
            const plus = u.slice();
            for (let q = p + 1; q <= N; q++) {
              if (!plus[q]) continue;
              const more = unionBranchesAt(token, q);
              for (let r = q + 1; r <= N; r++) if (more[r]) plus[r] = 1;
            }
            if (token.operator === "*") next[p] = 1;
            for (let q = p; q <= N; q++) if (plus[q]) next[q] = 1;
          } else if (token.operator === "!") {
            for (let q = p; q <= N; q++) if (!u[q]) next[q] = 1;
          }
        }
      } else {
        for (let p = startCp; p < N; p++) {
          if (cur[p] && acceptsSingleChar(token, chars[p]!, ignoreCase)) {
            next[p + 1] = 1;
          }
        }
      }
      cur = next;
    }
    return cur;
  };

  return { allEnds, N };
}

export async function compilePattern(pattern: string, work: StringWork, ignoreCase = false, extglob = false): Promise<(value: string, start?: number, end?: number) => boolean | Promise<boolean>> {
  work.signal.throwIfAborted();
  const { patternTokens } = await tokens(pattern, work, ignoreCase, extglob);
  if (hasExtglobTokens(patternTokens)) {
    return (value, start = 0, end = value.length) => {
      const chars = Array.from(value.slice(start, end));
      const evaluator = createExtglobEvaluator(chars, work, ignoreCase);
      return evaluator.allEnds(patternTokens, 0)[evaluator.N] === 1;
    };
  }
  return (value, start = 0, end = value.length) => matchTokens(patternTokens, value, work, start, end, ignoreCase);
}

export async function matchesPattern(pattern: string, value: string, work: StringWork, ignoreCase = false, extglob = false): Promise<boolean> {
  const { patternTokens, reservation } = await tokens(pattern, work, ignoreCase, extglob);
  try {
    if (hasExtglobTokens(patternTokens)) {
      const chars = Array.from(value);
      const evaluator = createExtglobEvaluator(chars, work, ignoreCase);
      return evaluator.allEnds(patternTokens, 0)[evaluator.N] === 1;
    }
    return await matchTokens(patternTokens, value, work, 0, value.length, ignoreCase);
  }
  finally { reservation?.release(); }
}

export async function compilePatternBoundaries(pattern: string, work: StringWork, ignoreCase = false, extglob = false): Promise<(value: string, shortest?: boolean, suffix?: boolean) => Promise<Float64Array>> {
  work.signal.throwIfAborted();
  const { patternTokens } = await tokens(pattern, work, ignoreCase, extglob);
  if (hasExtglobTokens(patternTokens)) {
    return async (value, shortest = false, suffix = false) => {
      const resultSize = value.length + 1;
      const initialized = stringCheckpoint(work, resultSize);
      if (initialized) await initialized;
      const ends = new Float64Array(resultSize).fill(-1);
      const chars: string[] = [];
      const utf16Offsets: number[] = [];
      for (let pos = 0; pos < value.length;) {
        utf16Offsets.push(pos);
        const cp = value.codePointAt(pos)!;
        const ch = String.fromCodePoint(cp);
        chars.push(ch);
        pos += ch.length;
      }
      utf16Offsets.push(value.length);
      const evaluator = createExtglobEvaluator(chars, work, ignoreCase);
      const N = evaluator.N;
      for (let startCp = 0; startCp <= N; startCp++) {
        const pending = stringCheckpoint(work);
        if (pending) await pending;
        const reach = evaluator.allEnds(patternTokens, startCp);
        const startOffset = utf16Offsets[startCp]!;
        if (suffix) {
          ends[startOffset] = reach[N] === 1 ? value.length : -1;
        } else if (shortest) {
          for (let endCp = startCp; endCp <= N; endCp++) {
            if (reach[endCp] === 1) {
              ends[startOffset] = utf16Offsets[endCp]!;
              break;
            }
          }
        } else {
          for (let endCp = N; endCp >= startCp; endCp--) {
            if (reach[endCp] === 1) {
              ends[startOffset] = utf16Offsets[endCp]!;
              break;
            }
          }
        }
      }
      return ends;
    };
  }
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
            const accepts = point !== undefined && (token.kind === "any" || (token.kind === "literal" ? token.value.codePointAt(0) === point || ignoreCase && token.value.toLowerCase() === String.fromCodePoint(point).toLowerCase() : token.expression.test(String.fromCodePoint(point))));
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

function matchTokens(patternTokens: PatternToken[], value: string, work: StringWork, start: number, end: number, ignoreCase = false): boolean | Promise<boolean> {
  work.signal.throwIfAborted();
  let position = start;
  let tokenIndex = 0;
  let star = -1;
  let retry = start;
  while (position < end) {
    const pending = stringCheckpoint(work);
    if (pending) return matchTokensAsync(patternTokens, value, work, end, ignoreCase, position, tokenIndex, star, retry, pending);
    work.signal.throwIfAborted();
    const token = patternTokens[tokenIndex];
    const point = value.codePointAt(position)!;
    if (token?.kind === "star") { star = tokenIndex++; retry = position; }
    else if (token && (token.kind === "any" || (token.kind === "literal" ? token.value.codePointAt(0) === point || ignoreCase && token.value.toLowerCase() === String.fromCodePoint(point).toLowerCase() : token.expression.test(String.fromCodePoint(point))))) {
      position += point > 0xffff ? 2 : 1;
      tokenIndex++;
    } else if (star !== -1) { tokenIndex = star + 1; retry = nextCodePointOffset(value, retry); position = retry; }
    else return false;
  }
  work.signal.throwIfAborted();
  while (patternTokens[tokenIndex]?.kind === "star") tokenIndex++;
  return tokenIndex === patternTokens.length;
}

async function matchTokensAsync(
  patternTokens: PatternToken[],
  value: string,
  work: StringWork,
  end: number,
  ignoreCase: boolean,
  position: number,
  tokenIndex: number,
  star: number,
  retry: number,
  initialPending: Promise<void>,
): Promise<boolean> {
  await initialPending;
  while (position < end) {
    work.signal.throwIfAborted();
    const token = patternTokens[tokenIndex];
    const point = value.codePointAt(position)!;
    if (token?.kind === "star") { star = tokenIndex++; retry = position; }
    else if (token && (token.kind === "any" || (token.kind === "literal" ? token.value.codePointAt(0) === point || ignoreCase && token.value.toLowerCase() === String.fromCodePoint(point).toLowerCase() : token.expression.test(String.fromCodePoint(point))))) {
      position += point > 0xffff ? 2 : 1;
      tokenIndex++;
    } else if (star !== -1) { tokenIndex = star + 1; retry = nextCodePointOffset(value, retry); position = retry; }
    else return false;
    const pending = stringCheckpoint(work);
    if (pending) await pending;
  }
  work.signal.throwIfAborted();
  while (patternTokens[tokenIndex]?.kind === "star") tokenIndex++;
  return tokenIndex === patternTokens.length;
}
