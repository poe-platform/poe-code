import { CsvBudget, CsvError } from "safe-bash-csv-engine";
export interface MatchOptions {
  regex?: string;
  file?: string;
  match?: string;
}
export function pythonWhitespace(code: number): boolean {
  return (
    (code >= 9 && code <= 13) ||
    (code >= 28 && code <= 32) ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    [0x2028, 0x2029, 0x202f, 0x205f, 0x3000].includes(code)
  );
}
export function pythonRstrip(text: string): string {
  let end = text.length;
  while (end && pythonWhitespace(text.charCodeAt(end - 1))) end--;
  return text.slice(0, end);
}
// Unicode 13.0 Nd block starts, Python 3.9 baseline; each block has ten code points.
const digitStarts = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6,
  0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50,
  0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0,
  0x10d30, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650, 0x116c0, 0x11730,
  0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0, 0x16a60, 0x16b50, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec,
  0x1d7f6, 0x1e140, 0x1e2f0, 0x1e950, 0x1fbf0
];
type Atom =
  | { kind: "cell"; test: (char: string) => boolean }
  | { kind: "anchor"; test: (chars: readonly string[], at: number) => boolean };
export type CellMatcher = ((text: string) => boolean) | undefined;
function compile(pattern: string, b: CsvBudget): CellMatcher {
  const atoms: Atom[] = [];
  let ascii = false,
    ignoreCase = false,
    multiline = false,
    dotall = false,
    offset = 0;
  if (pattern.startsWith("(?")) {
    const end = pattern.indexOf(")");
    if (end < 0) throw new CsvError("REGEX", "missing ), unterminated subpattern at position 0");
    const flags = pattern.slice(2, end);
    if (!flags || [...flags].some((flag) => !["a", "i", "m", "s", "u"].includes(flag)))
      throw new CsvError("UNSUPPORTED", "Unsupported Python regex flags or group");
    if (flags.includes("a") && flags.includes("u"))
      throw new CsvError("REGEX", "ASCII and UNICODE flags are incompatible");
    ascii = flags.includes("a");
    ignoreCase = flags.includes("i");
    multiline = flags.includes("m");
    dotall = flags.includes("s");
    offset = end + 1;
  }
  const fold = (char: string): string => {
    if (!ignoreCase) return char;
    if (!ascii) {
      if (char === "İ" || char === "ı") return "i";
      if (char === "ſ") return "s";
      if (char === "K") return "k";
    }
    const code = char.codePointAt(0)!;
    return code >= 65 && code <= 90 ? String.fromCodePoint(code + 32) : char;
  };
  const literal = (char: string): ((cell: string) => boolean) => {
    if (ignoreCase && char.codePointAt(0)! > 127)
      throw new CsvError("UNSUPPORTED", "Non-ASCII ignore-case literals are unqualified");
    return (cell) => fold(cell) === fold(char);
  };
  const category = (char: string): ((cell: string) => boolean) => {
    if (!["d", "D", "s", "S"].includes(char))
      throw new CsvError("UNSUPPORTED", `Unsupported Python regex escape \\${char}`);
    return (cell) => {
      const code = cell.codePointAt(0)!;
      b.charge("work", digitStarts.length + 1);
      const result =
        char.toLowerCase() === "d"
          ? ascii
            ? code >= 48 && code <= 57
            : digitStarts.some((start) => code >= start && code < start + 10)
          : ascii
            ? (code >= 9 && code <= 13) || code === 32
            : pythonWhitespace(code);
      return char === char.toUpperCase() ? !result : result;
    };
  };
  const escape = (char: string): ((cell: string) => boolean) => {
    if (["d", "D", "s", "S"].includes(char)) return category(char);
    const values: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      f: "\f",
      v: "\v",
      a: "\x07"
    };
    if (values[char]) return literal(values[char]!);
    if ("\\.^$[](){}*+?|/-".includes(char)) return literal(char);
    throw new CsvError("UNSUPPORTED", `Unsupported Python regex escape \\${char}`);
  };
  for (let i = offset; i < pattern.length; ) {
    b.charge("work", 1);
    b.charge("retainedBytes", 128);
    const char = String.fromCodePoint(pattern.codePointAt(i)!);
    i += char.length;
    if (char === "(") {
      if (pattern.indexOf(")", i) >= 0)
        throw new CsvError("UNSUPPORTED", "Groups are unsupported by bounded-sequence-v1");
      throw new CsvError("REGEX", `missing ), unterminated subpattern at position ${i - 1}`);
    }
    if (")*+?{}|".includes(char))
      throw new CsvError(
        "UNSUPPORTED",
        "Groups, alternation and repetition are not supported by bounded-sequence-v1"
      );
    if (char === "^")
      atoms.push({
        kind: "anchor",
        test: (chars, at) => at === 0 || (multiline && chars[at - 1] === "\n")
      });
    else if (char === "$")
      atoms.push({
        kind: "anchor",
        test: (chars, at) =>
          at === chars.length || (chars[at] === "\n" && (multiline || at === chars.length - 1))
      });
    else if (char === ".") atoms.push({ kind: "cell", test: (cell) => dotall || cell !== "\n" });
    else if (char === "\\") {
      const next = pattern[i++];
      if (next === undefined) throw new CsvError("REGEX", "bad escape (end of pattern)");
      if (next === "A" || next === "Z")
        atoms.push({
          kind: "anchor",
          test: (chars, at) => (next === "A" ? at === 0 : at === chars.length)
        });
      else atoms.push({ kind: "cell", test: escape(next) });
    } else if (char === "[") {
      const negate = pattern[i] === "^";
      if (negate) i++;
      const tests: ((cell: string) => boolean)[] = [];
      let closed = false;
      while (i < pattern.length) {
        b.charge("work", 1);
        b.charge("retainedBytes", 96);
        if (pattern[i] === "]" && tests.length) {
          i++;
          closed = true;
          break;
        }
        const first = String.fromCodePoint(pattern.codePointAt(i)!);
        i += first.length;
        if (first === "\\") {
          const next = pattern[i++];
          if (!next) throw new CsvError("REGEX", "unterminated character set");
          tests.push(escape(next));
        } else if (pattern[i] === "-" && pattern[i + 1] !== "]" && pattern[i + 1] !== undefined) {
          i++;
          const last = String.fromCodePoint(pattern.codePointAt(i)!);
          i += last.length;
          if (last === "\\")
            throw new CsvError("UNSUPPORTED", "Escaped range endpoints are unsupported");
          if (ignoreCase && (first.codePointAt(0)! > 127 || last.codePointAt(0)! > 127))
            throw new CsvError("UNSUPPORTED", "Non-ASCII ignore-case ranges are unqualified");
          if (
            ignoreCase &&
            !(
              (first >= "a" && first <= "z" && last >= "a" && last <= "z") ||
              (first >= "A" && first <= "Z" && last >= "A" && last <= "Z")
            )
          )
            throw new CsvError(
              "UNSUPPORTED",
              "Ignore-case ranges require same-case ASCII letter endpoints"
            );
          const start = fold(first).codePointAt(0)!,
            end = fold(last).codePointAt(0)!;
          if (end < start) throw new CsvError("REGEX", "bad character range");
          tests.push((cell) => {
            const code = fold(cell).codePointAt(0)!;
            return code >= start && code <= end;
          });
        } else tests.push(literal(first));
      }
      if (!closed) throw new CsvError("REGEX", "unterminated character set");
      atoms.push({
        kind: "cell",
        test: (cell) => {
          b.charge("work", tests.length);
          return tests.some((test) => test(cell)) !== negate;
        }
      });
    } else if (char === "]") throw new CsvError("UNSUPPORTED", "Unescaped closing class delimiter");
    else atoms.push({ kind: "cell", test: literal(char) });
  }
  return (text) => {
    b.charge("work", text.length);
    b.charge("retainedBytes", text.length * 24 + 32);
    const chars = Array.from(text);
    for (let start = 0; start <= chars.length; start++) {
      let at = start,
        matched = true;
      for (const atom of atoms) {
        b.charge("work", 1);
        if (atom.kind === "anchor") {
          if (!atom.test(chars, at)) {
            matched = false;
            break;
          }
        } else if (at === chars.length || !atom.test(chars[at++]!)) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
    return false;
  };
}
export function createMatcher(
  options: MatchOptions,
  set: ReadonlySet<string>,
  b: CsvBudget
): CellMatcher {
  const pattern = options.regex || (options.file === undefined ? options.match : undefined);
  if (pattern !== undefined) {
    b.charge("patternBytes", pattern.length); // lower bound before encoding
    b.charge("work", pattern.length);
    b.charge("retainedBytes", pattern.length * 3);
    const bytes = new TextEncoder().encode(pattern).length;
    b.charge("patternBytes", bytes - pattern.length);
  }
  if (options.regex) return compile(options.regex, b);
  if (options.file !== undefined)
    return (text) => {
      b.charge("work", text.length + 1);
      return set.has(text);
    };
  if (!options.match) return undefined;
  const literal = options.match;
  return (text) => {
    for (let start = 0; start <= text.length - literal.length; start++) {
      let matched = true;
      for (let i = 0; i < literal.length; i++) {
        b.charge("work", 1);
        if (text[start + i] !== literal[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
    return false;
  };
}
export function matchesRow(
  cells: readonly string[],
  columns: readonly number[],
  match: CellMatcher,
  any: boolean,
  invert: boolean,
  b: CsvBudget
): boolean {
  let aggregate = !any;
  if (match)
    for (const column of columns) {
      b.charge("scannedCells", 1);
      b.charge("work", 1);
      const found = match(cells[column] ?? "");
      if (any && found) {
        aggregate = true;
        break;
      }
      if (!any && !found) {
        aggregate = false;
        break;
      }
    }
  return aggregate !== invert;
}
