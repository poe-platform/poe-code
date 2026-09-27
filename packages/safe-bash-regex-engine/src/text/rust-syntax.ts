import { ProgramError } from "./budget.js";
import type { RegexNode as Node } from "./regex-syntax.js";

export class RustPatternError extends ProgramError {
  constructor(message: string, readonly offset: number, readonly compilation = false) { super(message); }
}

export function simpleCaseFold(text: string): string {
  let result = "";
  for (const char of text) {
    const lower = char.toLowerCase(), upper = lower.toUpperCase();
    result += char === "ı" || [...lower].length !== 1 ? char : [...upper].length === 1 ? upper.toLowerCase() : lower;
  }
  return result;
}

const word = (char: string): boolean => /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]$/u.test(char);
const asciiWord = (char: string): boolean => /^[A-Za-z0-9_]$/u.test(char);

function property(name: string, insensitive: boolean): (char: string) => boolean {
  // The host only classifies one scalar using a validated Unicode property.
  // No user expression or repetition reaches its regular-expression matcher.
  if (!name || [...name].some(c => !" _-=0123456789".includes(c) && !(c >= "A" && c <= "Z") && !(c >= "a" && c <= "z"))) throw new ProgramError("invalid Unicode character class");
  const clean = name.split(" ").join("").split("-").join("_");
  const equals = clean.indexOf("="), key = equals < 0 ? "" : clean.slice(0, equals), value = equals < 0 ? clean : clean.slice(equals + 1);
  const title = value.split("_").map(part => part[0]?.toUpperCase() + part.slice(1).toLowerCase()).join("_");
  const keys: Record<string, string> = { sc: "Script", script: "Script", scx: "Script_Extensions", scriptextensions: "Script_Extensions", script_extensions: "Script_Extensions", gc: "General_Category", generalcategory: "General_Category", general_category: "General_Category" };
  const prefix = key ? (keys[key.toLowerCase()] ?? key) + "=" : "";
  const candidates = [prefix + value, prefix + title];
  if (!key) candidates.push("Script=" + value, "Script=" + title);
  if (clean.toLowerCase() === "any") return () => true;
  if (clean.toLowerCase() === "ascii") return char => char.codePointAt(0)! <= 127;
  for (const candidate of candidates) {
    try {
      const pattern = new RegExp(`^\\p{${candidate}}$`, insensitive ? "iu" : "u");
      return char => pattern.test(char);
    } catch { /* Try a canonical property or script alias. */ }
  }
  throw new ProgramError(`Unicode property not found: ${name}`);
}

export function parseRustPattern(source: string, ignoreCase: boolean, maximumDepth = Infinity): { root: Node; groupCount: number; groupNames: Map<string, number> } {
  let at = 0, depth = 0, groupCount = 0;
  let flags = new Set(ignoreCase ? ["u", "i"] : ["u"]);
  const groupNames = new Map<string, number>(), references = new Set<number>();
  let numberedReferences = false;
  function fail(message: string, offset = at, compilation = false): never { throw new RustPatternError(message, offset, compilation); }
  const enter = (): void => { if (++depth > maximumDepth) throw new ProgramError("rust regular expression depth limit exceeded"); };
  const skip = (): void => {
    if (!flags.has("x")) return;
    while (at < source.length) {
      if (" \t\n\r\f\v".includes(source[at]!)) { at++; continue; }
      if (source[at] !== "#") break;
      while (at < source.length && source[at] !== "\n") at++;
    }
  };
  const scalar = (): string => {
    if (at >= source.length) throw new ProgramError("unexpected end of regular expression");
    const char = String.fromCodePoint(source.codePointAt(at)!); at += char.length; return char;
  };
  const literal = (char: string): Node => {
    const insensitive = flags.has("i"), folded = simpleCaseFold(char);
    return { type: "character", ...(insensitive ? {} : { literal: char }), accepts: candidate => insensitive ? simpleCaseFold(candidate) === folded : candidate === char };
  };
  const classEscape = (): ((char: string) => boolean) | undefined => {
    const char = source[at];
    if (char === "p" || char === "P") {
      at++; let name: string;
      if (source[at] === "{") {
        const end = source.indexOf("}", ++at);
        if (end < 0) throw new ProgramError("Unicode escape not closed");
        name = source.slice(at, end); at = end + 1;
      } else name = scalar();
      let accepts: (char: string) => boolean;
      try { accepts = property(name, flags.has("i")); }
      catch { return fail("Regex error: error parsing pattern 0", at, true); }
      return char === "p" ? accepts : value => !accepts(value);
    }
    if (char === undefined || !"dDsSwWhH".includes(char)) return;
    at++;
    const unicode = flags.has("u"), lower = char.toLowerCase();
    const accepts = lower === "h" ? (value: string) => /^[0-9A-Fa-f]$/u.test(value) : lower === "w" ? unicode ? word : asciiWord
      : lower === "d" ? unicode ? (value: string) => /^\p{Nd}$/u.test(value) : (value: string) => value >= "0" && value <= "9"
      : unicode ? (value: string) => /^\p{White_Space}$/u.test(value) : (value: string) => " \t\n\r\f\v".includes(value);
    return char === lower ? accepts : value => !accepts(value);
  };
  const escaped = (): string => {
    const char = scalar();
    const controls: Record<string, string> = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", e: "\x1b" };
    if (controls[char] !== undefined) return controls[char];
    if (char === "x" || char === "u" || char === "U") {
      const escapeStart = at;
      const braced = source[at] === "{"; if (braced) at++;
      const begin = at, count = char === "x" ? 2 : char === "u" ? 4 : 8;
      while (at < source.length && "0123456789abcdefABCDEF".includes(source[at]!) && (braced || at - begin < count)) at++;
      const hex = source.slice(begin, at), value = Number.parseInt(hex, 16);
      if (!hex || braced && source[at++] !== "}" || !braced && hex.length !== count || value > 0x10ffff || value >= 0xd800 && value <= 0xdfff) fail("Invalid hex escape", escapeStart);
      return String.fromCodePoint(value);
    }
    if (char >= "A" && char <= "Z" || char >= "a" && char <= "z") fail(`Invalid escape: \\${char}`, at - 2);
    return char;
  };
  const bracket = (): Node => {
    enter(); skip();
    const negate = source[at] === "^"; if (negate) at++;
    const insensitive = flags.has("i");
    const token = (): { accepts: (char: string) => boolean; scalar?: string } => {
      skip();
      if (source[at] === "[") {
        if (source[at + 1] === ":") {
          const end = source.indexOf(":]", at + 2), name = source.slice(at + 2, end);
          const classes: Record<string, (char: string) => boolean> = {
            alnum: c => /^[A-Za-z0-9]$/u.test(c), alpha: c => /^[A-Za-z]$/u.test(c), ascii: c => c.codePointAt(0)! <= 127,
            blank: c => c === " " || c === "\t", cntrl: c => c.codePointAt(0)! <= 31 || c === "\x7f", digit: c => /^[0-9]$/u.test(c),
            graph: c => /^[!-~]$/u.test(c), lower: c => /^[a-z]$/u.test(c), print: c => /^[ -~]$/u.test(c),
            punct: c => /^[!-/:-@[-`{-~]$/u.test(c), space: c => " \t\n\r\f\v".includes(c), upper: c => /^[A-Z]$/u.test(c), word: asciiWord, xdigit: c => /^[A-Fa-f0-9]$/u.test(c)
          };
          const negative = name.startsWith("^"), accepts = classes[negative ? name.slice(1) : name];
          if (end < 0 || !accepts) throw new ProgramError("invalid ASCII character class");
          at = end + 2; return { accepts: negative ? c => !accepts(c) : accepts };
        }
        at++; const nested = bracket() as Extract<Node, { type: "character" }>; return { accepts: nested.accepts };
      }
      let char: string;
      if (source[at] === "\\") {
        at++; const accepts = classEscape(); if (accepts) return { accepts };
        char = escaped();
      } else char = scalar();
      return { accepts: candidate => candidate === char, scalar: char };
    };
    const union = (): ((char: string) => boolean) => {
      const terms: ((char: string) => boolean)[] = [];
      while (at < source.length) {
        skip();
        if (source[at] === "]" && terms.length || ["&&", "--", "~~"].some(op => source.startsWith(op, at))) break;
        const start = token(); skip();
        if (start.scalar !== undefined && source[at] === "-" && source[at + 1] !== "]" && source[at + 1] !== "-") {
          at++; const end = token();
          if (end.scalar === undefined || start.scalar.codePointAt(0)! > end.scalar.codePointAt(0)!) fail("Regex error: error parsing pattern 0", at, true);
          const low = start.scalar.codePointAt(0)!, high = end.scalar.codePointAt(0)!;
          terms.push(char => [...char].length === 1 && char.codePointAt(0)! >= low && char.codePointAt(0)! <= high);
        } else terms.push(start.accepts);
      }
      return char => terms.some(accepts => accepts(char));
    };
    let accepts = union();
    while (at < source.length && source[at] !== "]") {
      const op = source.slice(at, at + 2); at += 2;
      if (!["&&", "--", "~~"].includes(op)) throw new ProgramError("invalid character class operation");
      const left = accepts, right = union();
      accepts = op === "&&" ? char => left(char) && right(char) : op === "--" ? char => left(char) && !right(char) : char => left(char) !== right(char);
    }
    if (source[at] !== "]") fail("Invalid character class", at);
    at++;
    depth--;
    return { type: "character", accepts: char => {
      const lower = char.toLowerCase(), upper = char.toUpperCase();
      const found = accepts(char) || insensitive && (accepts(simpleCaseFold(char)) || char !== "ı" && [...upper].length === 1 && accepts(upper) || [...lower].length === 1 && accepts(lower));
      return negate ? !found : found;
    } };
  };
  const atom = (): Node => {
    skip(); const atomStart = at, char = scalar();
    if (char === "(") {
      enter(); const outer = new Set(flags);
      let capturing = true, atomic = false, name: string | undefined, assertion: { positive: boolean; behind: boolean } | undefined;
      if (source[at] === "?") {
        at++; const kind = source[at];
        if (kind === "#") {
          const close = source.indexOf(")", ++at);
          if (close < 0) fail("Opening parenthesis without closing parenthesis", at);
          at = close + 1; depth--; return { type: "empty" };
        }
        if (source.startsWith("P=", at)) {
          at += 2; const end = source.indexOf(")", at), name = source.slice(at, end), index = groupNames.get(name);
          if (end < 0) fail("Could not parse group name", at);
          if (index === undefined) fail("Invalid group name in back reference: " + name, at);
          at = end + 1; depth--; return { type: "backreference", index: index!, ignoreCase: flags.has("i"), fold: simpleCaseFold };
        }
        if (kind === "(") {
          at++; let condition: Node;
          const end = source.indexOf(")", at), token = source.slice(at, end);
          const stripped = token.startsWith("<") && token.endsWith(">") || token.startsWith("'") && token.endsWith("'") ? token.slice(1, -1) : token;
          const numeric = stripped.length > 0 && [...stripped].every(c => c >= "0" && c <= "9"), index = numeric ? Number(stripped) : groupNames.get(stripped);
          if (index !== undefined) {
            if (numeric) { references.add(index); numberedReferences = true; }
            condition = { type: "captureSet", index }; at = end;
          }
          else if (stripped !== token) fail("Invalid group name in back reference: " + stripped, at);
          else condition = alternate();
          if (source[at++] !== ")") fail("Opening parenthesis without closing parenthesis", at);
          const yes = sequence(); let no: Node = { type: "empty" };
          if (source[at] === "|") { at++; no = sequence(); }
          if (source[at++] !== ")") fail("Opening parenthesis without closing parenthesis", at);
          flags = outer; depth--; return { type: "conditional", condition, yes, no };
        }
        if (kind === ":" || kind === ">") { at++; capturing = false; atomic = kind === ">"; }
        else if (kind === "=" || kind === "!") { at++; capturing = false; assertion = { positive: kind === "=", behind: false }; }
        else if (kind === "<" && "=!".includes(source[at + 1] ?? "\0")) { at++; capturing = false; assertion = { positive: source[at++] === "=", behind: true }; }
        else if (kind === "<" || source.startsWith("P<", at)) {
          at += kind === "<" ? 1 : 2; const end = source.indexOf(">", at);
          if (end < 0) throw new ProgramError("invalid named capture");
          name = source.slice(at, end); at = end + 1;
          if (!name || groupNames.has(name) || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) fail("Could not parse group name", at);
        } else {
          let enabled = true, changed = false;
          while (at < source.length && source[at] !== ")" && source[at] !== ":") {
            const flag = source[at++]!;
            if (flag === "-") { enabled = false; continue; }
            if (flag === "u" && !enabled) fail("Disabling Unicode not supported", at - 1);
            if (!"imsxUu".includes(flag)) fail(`Unknown group flag: ${source.slice(atomStart, at)}`, atomStart + 2);
            changed = true; if (enabled) flags.add(flag); else flags.delete(flag);
          }
          if (!changed) throw new ProgramError("invalid regular expression group");
          if (source[at] === ")") { at++; depth--; return { type: "empty" }; }
          if (source[at++] !== ":") throw new ProgramError("unclosed regular expression group");
          capturing = false;
        }
      }
      const index = capturing ? ++groupCount : 0;
      if (name !== undefined) groupNames.set(name, index);
      const node = alternate(); skip();
      if (source[at] !== ")") fail("Opening parenthesis without closing parenthesis", at);
      at++; flags = outer; depth--;
      return atomic ? { type: "atomic", node } : assertion ? { type: "assertion", node, ...assertion } : capturing ? { type: "group", node, index, lastCapture: groupCount } : node;
    }
    if (char === "[") return bracket();
    if (char === "\\") {
      const accepts = classEscape(); if (accepts) return { type: "character", accepts };
      const escapedChar = source[at];
      if (escapedChar === "b" || escapedChar === "B" || escapedChar === "<" || escapedChar === ">") { at++; return { type: "boundary", accepts: word, positive: escapedChar !== "B", ...(escapedChar === "<" ? { edge: "start" } : escapedChar === ">" ? { edge: "end" } : {}) }; }
      if (escapedChar === "A" || escapedChar === "z" || escapedChar === "Z") { at++; return { type: escapedChar === "A" ? "begin" : "end", strict: true, ...(escapedChar === "Z" ? { trailingNewlines: true } : {}) }; }
      if (escapedChar === "G" || escapedChar === "K") { at++; return { type: escapedChar === "G" ? "continue" : "reset" }; }
      if (escapedChar && escapedChar >= "0" && escapedChar <= "9") {
        const begin = at++; while (source[at] && source[at]! >= "0" && source[at]! <= "9") at++;
        const index = Number(source.slice(begin, at));
        if (source[begin] === "0" && index !== 0) fail("Invalid back reference", begin);
        references.add(index); numberedReferences = true;
        return { type: "backreference", index, ignoreCase: flags.has("i"), fold: simpleCaseFold };
      }
      if (escapedChar === "k" || escapedChar === "g") {
        const open = source[at + 1], close = open === "'" ? "'" : ">", end = source.indexOf(close, at + 2);
        if (open !== "<" && open !== "'" || end < 0) fail("Could not parse group name", at + 1);
        if (escapedChar === "g") fail("Regex uses currently unimplemented feature: Subroutine Call", at, true);
        const name = source.slice(at + 2, end), number = Number(name);
        const numeric = name.length > 0 && Number.isInteger(number);
        const index = numeric ? name.startsWith("-") ? groupCount + number + 1 : name.startsWith("+") ? groupCount + number : number : groupNames.get(name);
        if (index === undefined) fail("Invalid group name in back reference: " + name, at + 1);
        if (numeric) { references.add(index!); numberedReferences = true; }
        at = end + 1; return { type: "backreference", index: index!, ignoreCase: flags.has("i"), fold: simpleCaseFold };
      }
      return literal(escaped());
    }
    if (char === ".") { const all = flags.has("s"); return { type: "character", accepts: value => all || value !== "\n" }; }
    if (char === "^" || char === "$") return { type: char === "^" ? "begin" : "end", multiline: flags.has("m"), strict: true };
    if ("*+?".includes(char)) fail("Target of repeat operator is invalid", atomStart);
    return literal(char);
  };
  const repeated = (): Node => {
    let node = atom(); skip(); const quantifier = source[at], quantifierStart = at;
    if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
      if (node.type === "empty") fail("Target of repeat operator is invalid", at);
      at++; node = { type: "repeat", node, minimum: quantifier === "+" ? 1 : 0, maximum: quantifier === "?" ? 1 : Infinity };
    } else if (quantifier === "{") {
      at++; const begin = at; while (source[at] && source[at]! >= "0" && source[at]! <= "9") at++;
      const hasMinimum = begin !== at, minimum = Number(source.slice(begin, at)); let maximum = minimum;
      if (source[at] === ",") { const begin = ++at; while (source[at] && source[at]! >= "0" && source[at]! <= "9") at++; maximum = begin === at ? Infinity : Number(source.slice(begin, at)); }
      if (source[at] !== "}" || !hasMinimum && maximum === minimum) { at = quantifierStart; return node; }
      at++;
      if (!Number.isSafeInteger(minimum) || maximum !== Infinity && !Number.isSafeInteger(maximum) || maximum < minimum) fail("Regex error: error parsing pattern 0", at, true);
      if (node.type === "empty") fail("Target of repeat operator is invalid", quantifierStart);
      node = { type: "repeat", node, minimum, maximum };
    }
    if (node.type === "repeat") {
      node.lazy = flags.has("U");
      if (source[at] === "?") { node.lazy = !node.lazy; at++; }
      else if (source[at] === "+") { node = { type: "atomic", node }; at++; }
    }
    if (source[at] && "*+?".includes(source[at]!)) fail("Target of repeat operator is invalid", at);
    return node;
  };
  const sequence = (): Node => {
    const nodes: Node[] = [];
    while (at < source.length) { skip(); if (at === source.length || source[at] === ")" || source[at] === "|") break; nodes.push(repeated()); }
    return nodes.length ? { type: "sequence", nodes } : { type: "empty" };
  };
  const alternate = (): Node => {
    const nodes = [sequence()];
    while (source[at] === "|") { at++; nodes.push(sequence()); }
    return nodes.length === 1 ? nodes[0]! : { type: "alternate", nodes };
  };
  const root = alternate();
  if (at !== source.length) fail("General parsing error: end of string not reached", at);
  for (const index of references) if (index <= 0 || index > groupCount) fail(`Invalid back reference to group ${index}`, at, true);
  if (numberedReferences && groupNames.size) fail("Numbered backref/call not allowed because named group was used, use a named backref instead", at, true);
  return { root, groupCount, groupNames };
}
