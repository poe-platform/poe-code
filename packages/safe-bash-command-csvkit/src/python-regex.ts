import { decimalZeroes } from "./unicode-profile.js";
import { CsvkitBlocked } from "./errors.js";

export function pythonWhitespace(char: string): boolean {
  const code = char.codePointAt(0)!;
  return (code >= 9 && code <= 13) || (code >= 28 && code <= 32) || code === 0x85 || code === 0xa0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
}

type Node = { kind: "char"; test: (char: string) => boolean } | { kind: "anchor"; test: (chars: readonly string[], position: number) => boolean } |
  { kind: "sequence"; nodes: Node[] } | { kind: "alternative"; nodes: Node[] } | { kind: "repeat"; node: Node; min: number; max: number } |
  { kind: "assertion"; node: Node; negative: boolean; behind: number | undefined };

/** A lookbehind's width is measured in Python code points, including astral characters. */
function fixedWidth(node: Node): number | undefined {
  if (node.kind === "char") return 1;
  if (node.kind === "anchor" || node.kind === "assertion") return 0;
  if (node.kind === "repeat") {
    const width = fixedWidth(node.node);
    return width === 0 ? 0 : width !== undefined && node.min === node.max ? width * node.min : undefined;
  }
  const widths = node.nodes.map(fixedWidth);
  if (widths.some(width => width === undefined)) return undefined;
  if (node.kind === "alternative") return widths.every(width => width === widths[0]) ? widths[0] : undefined;
  return (widths as number[]).reduce((sum, width) => sum + width, 0);
}

/** Bounded Python search subset. Unsupported syntax fails explicitly, never uses JS regex semantics. */
export function compilePythonSearch(pattern: string, step: () => void, maxWork: number, retain: (bytes: number) => void): (text: string) => boolean {
  retain(64 + pattern.length * 8);
  const chars = Array.from(pattern);
  let index = 0;
  let insensitive = false;
  let dotall = false;
  let multiline = false;
  let ascii = false;
  let unicode = false;
  const unsupported = (): never => { throw new CsvkitBlocked("Python regex syntax or diagnostic outside qualified subset"); };
  while (chars[index] === "(" && chars[index + 1] === "?") {
    let end = index + 2;
    while (chars[end] && "aimsu".includes(chars[end]!)) { step(); end++; }
    if (end > index + 2 && chars[end] === ")") {
      const flags = chars.slice(index + 2, end);
      insensitive ||= flags.includes("i"); dotall ||= flags.includes("s"); multiline ||= flags.includes("m"); ascii ||= flags.includes("a");
      unicode ||= flags.includes("u");
      if (ascii && unicode) unsupported();
      index = end + 1;
    } else break;
  }
  const digit = (char: string): boolean => ascii ? char >= "0" && char <= "9" : decimalZeroes.some(zero => char.codePointAt(0)! >= zero && char.codePointAt(0)! < zero + 10);
  const word = (char: string): boolean => {
    if (!ascii && char.codePointAt(0)! > 127) return unsupported();
    return char === "_" || /^[a-zA-Z0-9]$/.test(char);
  };
  const space = (char: string): boolean => ascii ? " \t\n\r\f\v".includes(char) : pythonWhitespace(char);
  const literal = (value: string): Node => ({ kind: "char", test: char => {
    // Python Unicode IGNORECASE has additional special folds; reject unqualified inputs.
    if (insensitive && (value.codePointAt(0)! > 127 || char.codePointAt(0)! > 127)) unsupported();
    return insensitive ? char.toLowerCase() === value.toLowerCase() : char === value;
  } });
  function escape(inClass = false): Node {
    const value = chars[index++];
    if (!value) return unsupported();
    if (value === "x" || value === "u" || value === "U") {
      const length = value === "x" ? 2 : value === "u" ? 4 : 8;
      let hex = "";
      for (let count = 0; count < length; count++) {
        step();
        const digit = chars[index++];
        if (!digit || !"0123456789abcdefABCDEF".includes(digit)) return unsupported();
        hex += digit;
      }
      const code = Number.parseInt(hex, 16);
      if (code > 0x10ffff) return unsupported();
      return literal(String.fromCodePoint(code));
    }
    const predicate = ({ d: digit, s: space, w: word } as Record<string, ((char: string) => boolean) | undefined>)[value.toLowerCase()];
    if (predicate) return { kind: "char", test: char => value === value.toLowerCase() ? predicate(char) : !predicate(char) };
    if (!inClass && (value === "A" || value === "Z" || value === "z")) return { kind: "anchor", test: (text, position) => value === "A" ? position === 0 : position === text.length };
    if (!inClass && (value === "b" || value === "B")) return { kind: "anchor", test: (text, position) => {
      if (value === "B" && text.length === 0) return true; // CPython 3.14
      const boundary = (position > 0 && word(text[position - 1]!)) !== (position < text.length && word(text[position]!));
      return value === "b" ? boundary : !boundary;
    } };
    const control = ({ n: "\n", r: "\r", t: "\t", f: "\f", v: "\v", a: "\x07", b: "\b" } as Record<string, string | undefined>)[value];
    if (control !== undefined) return literal(control);
    if (/^[a-zA-Z0-9]$/.test(value)) return unsupported();
    return literal(value);
  }
  function atom(): Node {
    step();
    const value = chars[index++];
    if (!value) return unsupported();
    if (value === "\\") return escape();
    if (value === ".") return { kind: "char", test: char => dotall || char !== "\n" };
    if (value === "^") return { kind: "anchor", test: (text, position) => position === 0 || (multiline && text[position - 1] === "\n") };
    if (value === "$") return { kind: "anchor", test: (text, position) => position === text.length || (text[position] === "\n" && (multiline || position === text.length - 1)) };
    if (value === "(") {
      let assertion: { negative: boolean; behind: boolean } | undefined;
      if (chars[index] === "?") {
        const modifier = chars[index + 1];
        if (modifier === ":") index += 2;
        else if (modifier === "=" || modifier === "!") {
          assertion = { negative: modifier === "!", behind: false }; index += 2;
        } else if (modifier === "<" && (chars[index + 2] === "=" || chars[index + 2] === "!")) {
          assertion = { negative: chars[index + 2] === "!", behind: true }; index += 3;
        } else return unsupported();
      }
      const node = expression();
      if (chars[index++] !== ")") return unsupported();
      if (assertion) {
        const behind = assertion.behind ? fixedWidth(node) : undefined;
        if (assertion.behind && behind === undefined) return unsupported();
        return { kind: "assertion", node, negative: assertion.negative, behind };
      }
      return node;
    }
    if (value === "[") {
      // Python emits FutureWarning for ambiguous set syntax. Never silently
      // erase that observable stderr while warning provenance is unqualified.
      if (chars[index] === "[") return unsupported();
      const negate = chars[index] === "^";
      if (negate) index++;
      const tests: ((char: string) => boolean)[] = [];
      while (index < chars.length && (chars[index] !== "]" || tests.length === 0)) {
        const first = chars[index++];
        if (first && "&|~".includes(first) && chars[index] === first) return unsupported();
        if (first === "-" && tests.length > 0 && chars[index] === "-") return unsupported();
        if (first === "\\") {
          const escaped = escape(true);
          if (escaped.kind !== "char") return unsupported();
          if (chars[index] === "-" && chars[index + 1] !== "]") return unsupported();
          tests.push(escaped.test);
        } else if (chars[index] === "-" && chars[index + 1] !== "]" && chars[index + 1] !== undefined) {
          index++;
          const last = chars[index++];
          if (!first || !last || last === "\\" || first.codePointAt(0)! > last.codePointAt(0)! || insensitive) return unsupported();
          tests.push(char => char.codePointAt(0)! >= first.codePointAt(0)! && char.codePointAt(0)! <= last.codePointAt(0)!);
        } else {
          const item = literal(first!);
          if (item.kind !== "char") return unsupported();
          tests.push(item.test);
        }
      }
      if (chars[index++] !== "]") return unsupported();
      return { kind: "char", test: char => tests.some(test => test(char)) !== negate };
    }
    if ("*+?{} )".includes(value) && value !== " ") return unsupported();
    return literal(value);
  }
  function expression(): Node {
    const alternatives: Node[] = [];
    do {
      const nodes: Node[] = [];
      while (index < chars.length && chars[index] !== "|" && chars[index] !== ")") {
        let node = atom();
        const quantifier = chars[index];
        if (quantifier && "*+?{".includes(quantifier)) {
          if (node.kind === "anchor") return unsupported();
          index++;
          let min = quantifier === "+" ? 1 : 0;
          let max = quantifier === "?" ? 1 : Infinity;
          if (quantifier === "{") {
            let digits = "";
            while (chars[index] && "0123456789".includes(chars[index]!)) { step(); digits += chars[index++]; }
            if (!digits && chars[index] !== ",") return unsupported();
            min = digits ? Number(digits) : 0; max = min;
            if (chars[index] === ",") {
              index++; digits = "";
              while (chars[index] && "0123456789".includes(chars[index]!)) { step(); digits += chars[index++]; }
              max = digits ? Number(digits) : Infinity;
            }
            if (chars[index++] !== "}" || min > max || !Number.isSafeInteger(min) || min >= 0xffffffff ||
              (max !== Infinity && (!Number.isSafeInteger(max) || max >= 0xffffffff))) return unsupported();
          }
          node = { kind: "repeat", node, min, max };
          if (chars[index] === "?") index++; // Greediness doesn't change search membership without captures.
          if (chars[index] === "+") return unsupported();
        }
        nodes.push(node);
      }
      alternatives.push({ kind: "sequence", nodes });
      if (chars[index] !== "|") break;
      index++;
    } while (index <= chars.length);
    return { kind: "alternative", nodes: alternatives };
  }
  const root = expression();
  if (index !== chars.length) unsupported();
  let work = 0;
  const tick = (): void => { step(); if (++work > maxWork) throw new CsvkitBlocked("Python regex work budget exceeded"); };
  function* evaluate(node: Node, text: readonly string[], position: number): Generator<number> {
    tick();
    if (node.kind === "char") { if (position < text.length && node.test(text[position]!)) yield position + 1; }
    else if (node.kind === "anchor") { if (node.test(text, position)) yield position; }
    else if (node.kind === "assertion") {
      const start = node.behind === undefined ? position : position - node.behind;
      let matched = false;
      if (start >= 0) for (const end of evaluate(node.node, text, start)) {
        if (node.behind === undefined || end === position) { matched = true; break; }
      }
      if (matched !== node.negative) yield position;
    }
    else if (node.kind === "alternative") { for (const child of node.nodes) yield* evaluate(child, text, position); }
    else if (node.kind === "sequence") {
      const nodes = node.nodes;
      function* sequence(index: number, offset: number): Generator<number> {
        tick();
        if (index === nodes.length) yield offset;
        else for (const next of evaluate(nodes[index]!, text, offset)) yield* sequence(index + 1, next);
      }
      yield* sequence(0, position);
    } else {
      let positions = new Set([position]);
      for (let count = 0; count <= node.max && positions.size; count++) {
        tick();
        if (count >= node.min) yield* positions;
        const next = new Set<number>();
        for (const offset of positions) for (const end of evaluate(node.node, text, offset)) {
          if (end !== offset || count < node.min) next.add(end);
        }
        positions = next;
      }
    }
  }
  return text => {
    retain(64 + text.length * 8);
    const input = Array.from(text);
    for (let start = 0; start <= input.length; start++) for (const ignored of evaluate(root, input, start)) { void ignored; return true; }
    return false;
  };
}
