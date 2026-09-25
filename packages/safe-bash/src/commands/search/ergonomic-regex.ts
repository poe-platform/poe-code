import type { Match, Row } from "../regex-execution/protocol.js";
import { SearchError } from "./options.js";

export interface ErgonomicRegexConfig {
  readonly kind: "rg" | "grep";
  readonly fixed: boolean;
  readonly extended?: boolean | undefined;
  readonly caseMode: "sensitive" | "insensitive" | "smart";
  readonly whole: boolean;
  readonly word: boolean;
  readonly nullData: boolean;
  readonly multiline?: boolean | undefined;
  readonly multilineDotall?: boolean | undefined;
}

export type PreparedErgonomicRegex =
  | {
      readonly mode: "delegated";
      readonly patterns: readonly string[];
      readonly extended: boolean;
    }
  | {
      readonly mode: "vm";
      readonly vm: ErgonomicVmMatcher;
      readonly crossLine: boolean;
    };

type ClassItem =
  | { readonly kind: "char"; readonly cp: number }
  | { readonly kind: "range"; readonly lo: number; readonly hi: number }
  | { readonly kind: "shorthand"; readonly id: "d" | "D" | "w" | "W" | "s" | "S" }
  | { readonly kind: "posix"; readonly name: string };

type AstNode =
  | { readonly type: "empty" }
  | { readonly type: "literal"; readonly cp: number; readonly insensitive: boolean }
  | { readonly type: "dot"; readonly dotall: boolean; readonly nullData: boolean }
  | { readonly type: "class"; readonly negated: boolean; readonly items: readonly ClassItem[]; readonly insensitive: boolean; readonly multiline: boolean }
  | { readonly type: "assert"; readonly kind: "bol" | "eol" | "wb" | "nwb" | "bow" | "eow" }
  | { readonly type: "seq"; readonly children: readonly AstNode[] }
  | { readonly type: "alt"; readonly branches: readonly AstNode[] }
  | { readonly type: "rep"; readonly child: AstNode; readonly min: number; readonly max: number; readonly lazy: boolean };

function isAsciiWordCp(cp: number): boolean {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 95;
}

function isAsciiSpaceCp(cp: number): boolean {
  return cp === 32 || cp === 9 || cp === 10 || cp === 11 || cp === 12 || cp === 13;
}

function foldAsciiCp(cp: number): number {
  return cp >= 65 && cp <= 90 ? cp + 32 : cp;
}

function matchPosixClass(name: string, cp: number, insensitive: boolean): boolean {
  const c = insensitive ? foldAsciiCp(cp) : cp;
  switch (name) {
    case "alnum": return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    case "alpha": return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    case "ascii": return c >= 0 && c <= 127;
    case "blank": return c === 32 || c === 9;
    case "cntrl": return (c >= 0 && c <= 31) || c === 127;
    case "digit": return c >= 48 && c <= 57;
    case "graph": return c >= 33 && c <= 126;
    case "lower": return insensitive ? ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) : (cp >= 97 && cp <= 122);
    case "print": return c >= 32 && c <= 126;
    case "punct": return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
    case "space": return isAsciiSpaceCp(c);
    case "upper": return insensitive ? ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) : (cp >= 65 && cp <= 90);
    case "word": return isAsciiWordCp(c);
    case "xdigit": return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
    default:
      throw new SearchError(`invalid ERE character class [:${name}:]`);
  }
}

function matchShorthand(id: "d" | "D" | "w" | "W" | "s" | "S", cp: number): boolean {
  switch (id) {
    case "d": return cp >= 48 && cp <= 57;
    case "D": return !(cp >= 48 && cp <= 57);
    case "w": return isAsciiWordCp(cp);
    case "W": return !isAsciiWordCp(cp);
    case "s": return isAsciiSpaceCp(cp);
    case "S": return !isAsciiSpaceCp(cp);
  }
}

function evalClassNode(
  node: Extract<AstNode, { type: "class" }>,
  cp: number,
): boolean {
  if (!node.multiline && cp === 10 && node.negated) {
    return false;
  }
  const target = node.insensitive ? foldAsciiCp(cp) : cp;
  let matched = false;
  for (let i = 0; i < node.items.length; i++) {
    const item = node.items[i]!;
    if (item.kind === "char") {
      const icp = node.insensitive ? foldAsciiCp(item.cp) : item.cp;
      if (target === icp) {
        matched = true;
        break;
      }
    } else if (item.kind === "range") {
      if (node.insensitive) {
        const lo = foldAsciiCp(item.lo);
        const hi = foldAsciiCp(item.hi);
        if ((target >= lo && target <= hi) || (cp >= item.lo && cp <= item.hi)) {
          matched = true;
          break;
        }
      } else if (cp >= item.lo && cp <= item.hi) {
        matched = true;
        break;
      }
    } else if (item.kind === "shorthand") {
      if (matchShorthand(item.id, cp)) {
        matched = true;
        break;
      }
    } else if (item.kind === "posix") {
      if (matchPosixClass(item.name, cp, node.insensitive)) {
        matched = true;
        break;
      }
    }
  }
  return node.negated ? !matched : matched;
}

interface ParseOutcome {
  readonly ast: AstNode;
  readonly translatedEre: string;
  readonly needsVm: boolean;
  readonly hasCrossLinePotential: boolean;
  readonly hasUppercaseLiteral: boolean;
}

const VALID_POSIX_CLASSES = new Set([
  "alnum", "alpha", "ascii", "blank", "cntrl", "digit", "graph",
  "lower", "print", "punct", "space", "upper", "word", "xdigit",
]);

function escapeEreLiteral(ch: string): string {
  if ("\\.^$*+?()[]{}|".includes(ch)) return `\\${ch}`;
  return ch;
}

function parsePattern(
  pattern: string,
  bre: boolean,
  insensitive: boolean,
  multiline: boolean,
  dotall: boolean,
  nullData: boolean,
): ParseOutcome {
  let pos = 0;
  let needsVm = false;
  let hasCrossLinePotential = dotall;
  let hasUppercaseLiteral = false;

  if (!multiline && pattern.includes("\n")) {
    throw new SearchError("unsupported ERE literal newline without --multiline (-U)");
  }
  if (pattern.includes("\n")) {
    needsVm = true;
    hasCrossLinePotential = true;
  }

  function parseBracket(): { node: AstNode; ere: string } {
    let negated = false;
    let ereInner = "";
    if (pos < pattern.length && pattern[pos] === "^") {
      negated = true;
      ereInner += "^";
      pos++;
      if (multiline) hasCrossLinePotential = true;
    }
    const items: ClassItem[] = [];
    let first = true;

    const readClassAtom = (): { item: ClassItem; ereText: string; isSingleChar: boolean; cp?: number } => {
      const ch = pattern[pos]!;
      if (ch === "[" && (pattern[pos + 1] === ":" || pattern[pos + 1] === "." || pattern[pos + 1] === "=")) {
        const kindChar = pattern[pos + 1]!;
        const closeIdx = pattern.indexOf(`${kindChar}]`, pos + 2);
        if (closeIdx < 0) throw new SearchError("invalid ERE: unclosed character class");
        if (kindChar !== ":") throw new SearchError("unsupported ERE collating or equivalence class");
        const name = pattern.slice(pos + 2, closeIdx);
        if (!VALID_POSIX_CLASSES.has(name)) {
          throw new SearchError(`invalid ERE character class [:${name}:]`);
        }
        if (name === "space") hasCrossLinePotential = true;
        pos = closeIdx + 2;
        return { item: { kind: "posix", name }, ereText: `[:${name}:]`, isSingleChar: false };
      }
      if (ch === "\\") {
        pos++;
        if (pos >= pattern.length) throw new SearchError("invalid ERE: trailing backslash in bracket expression");
        const esc = pattern[pos++]!;
        if (esc === "d") return { item: { kind: "shorthand", id: "d" }, ereText: "0-9", isSingleChar: false };
        if (esc === "w") return { item: { kind: "shorthand", id: "w" }, ereText: "[:alnum:]_", isSingleChar: false };
        if (esc === "s") {
          hasCrossLinePotential = true;
          return { item: { kind: "shorthand", id: "s" }, ereText: "[:space:]", isSingleChar: false };
        }
        if (esc === "D" || esc === "W" || esc === "S") {
          needsVm = true;
          hasCrossLinePotential = true;
          return { item: { kind: "shorthand", id: esc }, ereText: "", isSingleChar: false };
        }
        if (esc === "t") return { item: { kind: "char", cp: 9 }, ereText: "\t", isSingleChar: true, cp: 9 };
        if (esc === "r") return { item: { kind: "char", cp: 13 }, ereText: "\r", isSingleChar: true, cp: 13 };
        if (esc === "n") {
          if (!multiline) throw new SearchError("unsupported ERE '\\n' escape without --multiline (-U)");
          needsVm = true;
          hasCrossLinePotential = true;
          return { item: { kind: "char", cp: 10 }, ereText: "", isSingleChar: true, cp: 10 };
        }
        const cp = esc.codePointAt(0)!;
        if (cp >= 65 && cp <= 90) hasUppercaseLiteral = true;
        return { item: { kind: "char", cp }, ereText: esc === "]" || esc === "\\" || esc === "^" || esc === "-" ? `\\${esc}` : esc, isSingleChar: true, cp };
      }
      const cp = pattern.codePointAt(pos)!;
      const charStr = String.fromCodePoint(cp);
      pos += charStr.length;
      if (cp >= 65 && cp <= 90) hasUppercaseLiteral = true;
      return { item: { kind: "char", cp }, ereText: charStr, isSingleChar: true, cp };
    };

    while (pos < pattern.length) {
      if (pattern[pos] === "]" && !first) {
        pos++;
        return {
          node: { type: "class", negated, items, insensitive, multiline },
          ere: `[${ereInner}]`,
        };
      }
      first = false;
      const startAtom = readClassAtom();
      if (pos + 1 < pattern.length && pattern[pos] === "-" && pattern[pos + 1] !== "]") {
        pos++;
        const endAtom = readClassAtom();
        if (!startAtom.isSingleChar || !endAtom.isSingleChar || startAtom.cp === undefined || endAtom.cp === undefined || startAtom.cp > endAtom.cp) {
          throw new SearchError("invalid ERE character range");
        }
        items.push({ kind: "range", lo: startAtom.cp, hi: endAtom.cp });
        ereInner += `${startAtom.ereText}-${endAtom.ereText}`;
      } else {
        items.push(startAtom.item);
        ereInner += startAtom.ereText;
      }
    }
    throw new SearchError("invalid ERE: unclosed bracket expression");
  }

  function parseQuantifierBounds(): { min: number; max: number } {
    const closeSeq = bre ? "\\}" : "}";
    const closeIdx = pattern.indexOf(closeSeq, pos);
    if (closeIdx < 0) throw new SearchError("invalid ERE: unclosed repetition interval");
    const body = pattern.slice(pos, closeIdx);
    pos = closeIdx + closeSeq.length;
    if (!/^\d+(?:,\d*)?$/u.test(body)) {
      throw new SearchError(`invalid ERE repetition interval '{${body}}'`);
    }
    const parts = body.split(",");
    const min = Number(parts[0]!);
    const max = parts.length === 1 ? min : parts[1] === "" ? Infinity : Number(parts[1]!);
    if (!Number.isSafeInteger(min) || (max !== Infinity && (!Number.isSafeInteger(max) || max < min)) || min > 1000 || (max !== Infinity && max > 1000)) {
      throw new SearchError(`invalid ERE repetition bounds '{${body}}'`);
    }
    return { min, max };
  }

  function parseAlternation(inGroup: boolean): { node: AstNode; ere: string } {
    const branches: AstNode[] = [];
    const ereBranches: string[] = [];
    while (true) {
      const branch = parseSequence(inGroup);
      branches.push(branch.node);
      ereBranches.push(branch.ere);
      if (bre) {
        if (pos + 1 < pattern.length && pattern[pos] === "\\" && pattern[pos + 1] === "|") {
          pos += 2;
          continue;
        }
      } else {
        if (pos < pattern.length && pattern[pos] === "|") {
          pos++;
          continue;
        }
      }
      break;
    }
    if (branches.length === 1) return { node: branches[0]!, ere: ereBranches[0]! };
    for (const b of branches) {
      if (b.type === "empty") needsVm = true;
    }
    return { node: { type: "alt", branches }, ere: ereBranches.join("|") };
  }

  function parseSequence(inGroup: boolean): { node: AstNode; ere: string } {
    const nodes: AstNode[] = [];
    const eres: string[] = [];

    while (pos < pattern.length) {
      if (bre) {
        if (pos + 1 < pattern.length && pattern[pos] === "\\") {
          const next = pattern[pos + 1]!;
          if (next === "|" || next === ")") break;
        }
      } else {
        const ch = pattern[pos]!;
        if (ch === "|" || (ch === ")" && inGroup)) break;
        if (ch === ")" && !inGroup) throw new SearchError("invalid ERE: unmatched ')'");
      }

      let atomNode: AstNode;
      let atomEre: string;
      let quantifiable = true;

      const ch = pattern[pos]!;
      if (ch === "^") {
        pos++;
        atomNode = { type: "assert", kind: "bol" };
        atomEre = "^";
        quantifiable = false;
      } else if (ch === "$") {
        pos++;
        atomNode = { type: "assert", kind: "eol" };
        atomEre = "$";
        quantifiable = false;
      } else if (ch === ".") {
        pos++;
        atomNode = { type: "dot", dotall, nullData };
        atomEre = ".";
      } else if (ch === "[") {
        pos++;
        const br = parseBracket();
        atomNode = br.node;
        atomEre = br.ere;
      } else if (!bre && ch === "(") {
        pos++;
        if (pattern[pos] === "?") {
          pos++;
          if (pattern[pos] === ":") {
            pos++;
          } else if (pattern[pos] === "=" || pattern[pos] === "!" || (pattern[pos] === "<" && (pattern[pos + 1] === "=" || pattern[pos + 1] === "!"))) {
            throw new SearchError("unsupported ERE lookaround");
          } else {
            throw new SearchError("unsupported ERE group syntax");
          }
        }
        const inner = parseAlternation(true);
        if (pos >= pattern.length || pattern[pos] !== ")") {
          throw new SearchError("invalid ERE: unclosed '('");
        }
        pos++;
        if (inner.node.type === "empty") needsVm = true;
        atomNode = inner.node;
        atomEre = `(${inner.ere})`;
      } else if (!bre && (ch === "*" || ch === "+" || ch === "?" || ch === "{")) {
        throw new SearchError(`invalid ERE: unexpected quantifier '${ch}'`);
      } else if (bre && ch === "*") {
        if (nodes.length === 0) {
          pos++;
          atomNode = { type: "literal", cp: 42, insensitive };
          atomEre = "\\*";
        } else {
          throw new SearchError("invalid BRE: unexpected '*'");
        }
      } else if (ch === "\\") {
        pos++;
        if (pos >= pattern.length) throw new SearchError("invalid ERE: trailing backslash");
        const esc = pattern[pos++]!;
        if (esc >= "1" && esc <= "9") {
          throw new SearchError("unsupported ERE backreference");
        }
        if (bre && esc === "(") {
          const inner = parseAlternation(true);
          if (pos + 1 >= pattern.length || pattern[pos] !== "\\" || pattern[pos + 1] !== ")") {
            throw new SearchError("invalid BRE: unclosed '\\('");
          }
          pos += 2;
          if (inner.node.type === "empty") needsVm = true;
          atomNode = inner.node;
          atomEre = `(${inner.ere})`;
        } else if (bre && esc === ")") {
          throw new SearchError("invalid BRE: unmatched '\\)'");
        } else if (esc === "d") {
          atomNode = { type: "class", negated: false, items: [{ kind: "shorthand", id: "d" }], insensitive: false, multiline };
          atomEre = "[0-9]";
        } else if (esc === "D") {
          hasCrossLinePotential = true;
          atomNode = { type: "class", negated: false, items: [{ kind: "shorthand", id: "D" }], insensitive: false, multiline };
          atomEre = "[^0-9]";
        } else if (esc === "w") {
          atomNode = { type: "class", negated: false, items: [{ kind: "shorthand", id: "w" }], insensitive: false, multiline };
          atomEre = "[[:alnum:]_]";
        } else if (esc === "W") {
          hasCrossLinePotential = true;
          atomNode = { type: "class", negated: false, items: [{ kind: "shorthand", id: "W" }], insensitive: false, multiline };
          atomEre = "[^[:alnum:]_]";
        } else if (esc === "s") {
          hasCrossLinePotential = true;
          atomNode = { type: "class", negated: false, items: [{ kind: "shorthand", id: "s" }], insensitive: false, multiline };
          atomEre = "[[:space:]]";
        } else if (esc === "S") {
          hasCrossLinePotential = true;
          atomNode = { type: "class", negated: false, items: [{ kind: "shorthand", id: "S" }], insensitive: false, multiline };
          atomEre = "[^[:space:]]";
        } else if (esc === "b") {
          needsVm = true;
          atomNode = { type: "assert", kind: "wb" };
          atomEre = "";
          quantifiable = false;
        } else if (esc === "B") {
          needsVm = true;
          atomNode = { type: "assert", kind: "nwb" };
          atomEre = "";
          quantifiable = false;
        } else if (esc === "<") {
          needsVm = true;
          atomNode = { type: "assert", kind: "bow" };
          atomEre = "";
          quantifiable = false;
        } else if (esc === ">") {
          needsVm = true;
          atomNode = { type: "assert", kind: "eow" };
          atomEre = "";
          quantifiable = false;
        } else if (esc === "t") {
          atomNode = { type: "literal", cp: 9, insensitive: false };
          atomEre = "\t";
        } else if (esc === "r") {
          atomNode = { type: "literal", cp: 13, insensitive: false };
          atomEre = "\r";
        } else if (esc === "n") {
          if (!multiline) throw new SearchError("unsupported ERE '\\n' escape without --multiline (-U)");
          needsVm = true;
          hasCrossLinePotential = true;
          atomNode = { type: "literal", cp: 10, insensitive: false };
          atomEre = "";
        } else {
          const cp = esc.codePointAt(0)!;
          if (cp >= 65 && cp <= 90) hasUppercaseLiteral = true;
          atomNode = { type: "literal", cp, insensitive };
          atomEre = escapeEreLiteral(esc);
        }
      } else {
        const cp = pattern.codePointAt(pos)!;
        const charStr = String.fromCodePoint(cp);
        pos += charStr.length;
        if (cp >= 65 && cp <= 90) hasUppercaseLiteral = true;
        atomNode = { type: "literal", cp, insensitive };
        atomEre = escapeEreLiteral(charStr);
      }

      while (pos < pattern.length) {
        let min = -1;
        let max = -1;
        let qEre = "";
        if (bre) {
          if (pattern[pos] === "*") {
            pos++;
            min = 0; max = Infinity; qEre = "*";
          } else if (pos + 1 < pattern.length && pattern[pos] === "\\") {
            const next = pattern[pos + 1]!;
            if (next === "+") { pos += 2; min = 1; max = Infinity; qEre = "+"; }
            else if (next === "?") { pos += 2; min = 0; max = 1; qEre = "?"; }
            else if (next === "{") {
              pos += 2;
              const b = parseQuantifierBounds();
              min = b.min; max = b.max;
              qEre = `{${min}${max === min ? "" : max === Infinity ? "," : `,${max}`}}`;
            } else break;
          } else break;
        } else {
          const qch = pattern[pos]!;
          if (qch === "*") { pos++; min = 0; max = Infinity; qEre = "*"; }
          else if (qch === "+") { pos++; min = 1; max = Infinity; qEre = "+"; }
          else if (qch === "?") { pos++; min = 0; max = 1; qEre = "?"; }
          else if (qch === "{") {
            pos++;
            const b = parseQuantifierBounds();
            min = b.min; max = b.max;
            qEre = `{${min}${max === min ? "" : max === Infinity ? "," : `,${max}`}}`;
          } else break;
        }

        if (!quantifiable) {
          throw new SearchError("invalid ERE: assertion cannot be quantified");
        }
        let lazy = false;
        if (!bre && pos < pattern.length && pattern[pos] === "?") {
          pos++;
          lazy = true;
          needsVm = true;
        } else if (bre && pos + 1 < pattern.length && pattern[pos] === "\\" && pattern[pos + 1] === "?") {
          pos += 2;
          lazy = true;
          needsVm = true;
        }
        atomNode = { type: "rep", child: atomNode, min, max, lazy };
        atomEre = `${atomEre}${qEre}`;
      }

      nodes.push(atomNode);
      eres.push(atomEre);
    }

    if (nodes.length === 0) return { node: { type: "empty" }, ere: "" };
    if (nodes.length === 1) return { node: nodes[0]!, ere: eres[0]! };
    return { node: { type: "seq", children: nodes }, ere: eres.join("") };
  }

  const parsed = parseAlternation(false);
  if (pos < pattern.length) {
    throw new SearchError("invalid ERE: unexpected trailing tokens");
  }
  if (multiline && hasCrossLinePotential) {
    needsVm = true;
  }
  return {
    ast: parsed.node,
    translatedEre: parsed.ere,
    needsVm,
    hasCrossLinePotential,
    hasUppercaseLiteral,
  };
}

type NfaInst =
  | { readonly op: "accept" }
  | { readonly op: "jump"; readonly out: number }
  | { readonly op: "split"; readonly out1: number; readonly out2: number }
  | { readonly op: "assert"; readonly kind: "bol" | "eol" | "wb" | "nwb" | "bow" | "eow"; readonly out: number }
  | { readonly op: "literal"; readonly cp: number; readonly insensitive: boolean; readonly out: number }
  | { readonly op: "dot"; readonly dotall: boolean; readonly nullData: boolean; readonly out: number }
  | { readonly op: "class"; readonly node: Extract<AstNode, { type: "class" }>; readonly out: number };

function compileAstToNfa(root: AstNode): NfaInst[] {
  const insts: NfaInst[] = [];

  function emit(inst: NfaInst): number {
    const id = insts.length;
    insts.push(inst);
    return id;
  }

  function build(node: AstNode, next: number): number {
    switch (node.type) {
      case "empty":
        return next;
      case "literal":
        return emit({ op: "literal", cp: node.cp, insensitive: node.insensitive, out: next });
      case "dot":
        return emit({ op: "dot", dotall: node.dotall, nullData: node.nullData, out: next });
      case "class":
        return emit({ op: "class", node, out: next });
      case "assert":
        return emit({ op: "assert", kind: node.kind, out: next });
      case "seq": {
        let cur = next;
        for (let i = node.children.length - 1; i >= 0; i--) {
          cur = build(node.children[i]!, cur);
        }
        return cur;
      }
      case "alt": {
        let cur = build(node.branches[node.branches.length - 1]!, next);
        for (let i = node.branches.length - 2; i >= 0; i--) {
          const bStart = build(node.branches[i]!, next);
          cur = emit({ op: "split", out1: bStart, out2: cur });
        }
        return cur;
      }
      case "rep": {
        const { child, min, max, lazy } = node;
        let tail = next;
        if (max === Infinity) {
          const splitPlaceholder = emit({ op: "jump", out: next });
          const bodyStart = build(child, splitPlaceholder);
          insts[splitPlaceholder] = lazy
            ? { op: "split", out1: next, out2: bodyStart }
            : { op: "split", out1: bodyStart, out2: next };
          tail = splitPlaceholder;
        } else {
          for (let k = 0; k < max - min; k++) {
            const bodyStart = build(child, tail);
            tail = emit(
              lazy
                ? { op: "split", out1: tail, out2: bodyStart }
                : { op: "split", out1: bodyStart, out2: tail },
            );
          }
        }
        for (let k = 0; k < min; k++) {
          tail = build(child, tail);
        }
        return tail;
      }
    }
  }

  const acceptId = emit({ op: "accept" });
  const startId = build(root, acceptId);
  if (startId !== 0) {
    const reordered: NfaInst[] = [{ op: "jump", out: startId + 1 }];
    for (const inst of insts) {
      switch (inst.op) {
        case "accept":
          reordered.push(inst);
          break;
        case "jump":
          reordered.push({ op: "jump", out: inst.out + 1 });
          break;
        case "split":
          reordered.push({ op: "split", out1: inst.out1 + 1, out2: inst.out2 + 1 });
          break;
        case "assert":
          reordered.push({ op: "assert", kind: inst.kind, out: inst.out + 1 });
          break;
        case "literal":
          reordered.push({ op: "literal", cp: inst.cp, insensitive: inst.insensitive, out: inst.out + 1 });
          break;
        case "dot":
          reordered.push({ op: "dot", dotall: inst.dotall, nullData: inst.nullData, out: inst.out + 1 });
          break;
        case "class":
          reordered.push({ op: "class", node: inst.node, out: inst.out + 1 });
          break;
      }
    }
    return reordered;
  }
  return insts;
}

interface DecodedSubject {
  readonly cps: Int32Array;
  readonly offsets: Int32Array;
  readonly length: number;
}

function decodeUtf8Subject(bytes: Uint8Array): DecodedSubject {
  const len = bytes.length;
  let ascii = true;
  for (let i = 0; i < len; i++) {
    if (bytes[i]! >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) {
    const cps = new Int32Array(len);
    const offsets = new Int32Array(len + 1);
    for (let i = 0; i < len; i++) {
      cps[i] = bytes[i]!;
      offsets[i] = i;
    }
    offsets[len] = len;
    return { cps, offsets, length: len };
  }
  const cps = new Int32Array(len);
  const offsets = new Int32Array(len + 1);
  let count = 0;
  let i = 0;
  while (i < len) {
    offsets[count] = i;
    const b0 = bytes[i]!;
    if (b0 < 0x80) {
      cps[count++] = b0;
      i++;
    } else if ((b0 & 0xe0) === 0xc0 && i + 1 < len) {
      cps[count++] = ((b0 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0 && i + 2 < len) {
      cps[count++] = ((b0 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      i += 3;
    } else if ((b0 & 0xf8) === 0xf0 && i + 3 < len) {
      cps[count++] = ((b0 & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f);
      i += 4;
    } else {
      cps[count++] = b0;
      i++;
    }
  }
  offsets[count] = len;
  return { cps, offsets, length: count };
}

function extractLeadingLiteral(node: AstNode): { cp: number; insensitive: boolean } | undefined {
  if (node.type === "literal") {
    return { cp: node.cp, insensitive: node.insensitive };
  }
  if (node.type === "seq") {
    for (const child of node.children) {
      if (child.type === "empty" || child.type === "assert") continue;
      return extractLeadingLiteral(child);
    }
  }
  if (node.type === "rep" && node.min >= 1) {
    return extractLeadingLiteral(node.child);
  }
  return undefined;
}

export class ErgonomicVmMatcher {
  private readonly insts: readonly NfaInst[];
  private readonly multiline: boolean;
  private readonly visited: Int32Array;
  private readonly clistStates: Int32Array;
  private readonly clistStarts: Int32Array;
  private readonly nlistStates: Int32Array;
  private readonly nlistStarts: Int32Array;
  private readonly leadingLiteral: { cp: number; foldedCp: number; insensitive: boolean } | undefined;
  private stepStamp = 1;

  constructor(rootAst: AstNode, multiline: boolean) {
    this.insts = compileAstToNfa(rootAst);
    this.multiline = multiline;
    const n = this.insts.length;
    this.visited = new Int32Array(n);
    this.clistStates = new Int32Array(n);
    this.clistStarts = new Int32Array(n);
    this.nlistStates = new Int32Array(n);
    this.nlistStarts = new Int32Array(n);
    const lead = extractLeadingLiteral(rootAst);
    this.leadingLiteral = lead
      ? { cp: lead.cp, foldedCp: foldAsciiCp(lead.cp), insensitive: lead.insensitive }
      : undefined;
  }

  private evalAssertion(
    kind: "bol" | "eol" | "wb" | "nwb" | "bow" | "eow",
    cps: Int32Array,
    len: number,
    pos: number,
  ): boolean {
    switch (kind) {
      case "bol":
        return pos === 0 || (this.multiline && cps[pos - 1] === 10);
      case "eol":
        return pos === len || (this.multiline && cps[pos] === 10);
      case "wb": {
        const prevW = pos > 0 && isAsciiWordCp(cps[pos - 1]!);
        const nextW = pos < len && isAsciiWordCp(cps[pos]!);
        return prevW !== nextW;
      }
      case "nwb": {
        const prevW = pos > 0 && isAsciiWordCp(cps[pos - 1]!);
        const nextW = pos < len && isAsciiWordCp(cps[pos]!);
        return prevW === nextW;
      }
      case "bow": {
        const prevW = pos > 0 && isAsciiWordCp(cps[pos - 1]!);
        const nextW = pos < len && isAsciiWordCp(cps[pos]!);
        return !prevW && nextW;
      }
      case "eow": {
        const prevW = pos > 0 && isAsciiWordCp(cps[pos - 1]!);
        const nextW = pos < len && isAsciiWordCp(cps[pos]!);
        return prevW && !nextW;
      }
    }
  }

  private findNext(
    subject: DecodedSubject,
    fromCp: number,
    minEndIfAtFrom: number,
  ): { start: number; end: number } | undefined {
    const { cps, length } = subject;
    const insts = this.insts;
    const visited = this.visited;
    const clistStates = this.clistStates;
    const clistStarts = this.clistStarts;
    const nlistStates = this.nlistStates;
    const nlistStarts = this.nlistStarts;
    let clistLen = 0;
    let nlistLen = 0;
    const lead = this.leadingLiteral;

    let matchedStart = -1;
    let matchedEnd = -1;

    const addThread = (
      stateId: number,
      startPos: number,
      pos: number,
      stamp: number,
    ): boolean => {
      if (visited[stateId] === stamp) return false;
      visited[stateId] = stamp;
      const inst = insts[stateId]!;
      if (inst.op === "jump") {
        return addThread(inst.out, startPos, pos, stamp);
      }
      if (inst.op === "split") {
        if (addThread(inst.out1, startPos, pos, stamp)) return true;
        return addThread(inst.out2, startPos, pos, stamp);
      }
      if (inst.op === "assert") {
        if (this.evalAssertion(inst.kind, cps, length, pos)) {
          return addThread(inst.out, startPos, pos, stamp);
        }
        return false;
      }
      if (inst.op === "accept") {
        if (startPos === fromCp && pos < minEndIfAtFrom) {
          return false;
        }
        matchedStart = startPos;
        matchedEnd = pos;
        return true;
      }
      nlistStates[nlistLen] = stateId;
      nlistStarts[nlistLen] = startPos;
      nlistLen++;
      return false;
    };

    for (let pos = fromCp; pos <= length; pos++) {
      if (clistLen === 0 && matchedStart < 0 && lead !== undefined && pos < length) {
        if (!lead.insensitive) {
          while (pos < length && cps[pos] !== lead.cp) pos++;
        } else {
          while (pos < length && cps[pos] !== lead.cp && foldAsciiCp(cps[pos]!) !== lead.foldedCp) pos++;
        }
        if (pos > length) break;
      }
      const stamp = ++this.stepStamp;
      if (this.stepStamp >= 0x7ffffff0) {
        visited.fill(0);
        this.stepStamp = 1;
      }
      nlistLen = 0;

      let acceptedAtPos = false;
      for (let i = 0; i < clistLen; i++) {
        if (addThread(clistStates[i]!, clistStarts[i]!, pos, stamp)) {
          acceptedAtPos = true;
          break;
        }
      }

      if (!acceptedAtPos && matchedStart < 0) {
        addThread(0, pos, pos, stamp);
      }

      if (matchedStart >= 0 && nlistLen === 0) {
        return { start: matchedStart, end: matchedEnd };
      }
      if (pos === length) break;

      const cp = cps[pos]!;
      clistLen = 0;
      for (let i = 0; i < nlistLen; i++) {
        const st = nlistStates[i]!;
        const startPos = nlistStarts[i]!;
        const inst = insts[st]!;
        let nextOut = -1;
        if (inst.op === "literal") {
          if (inst.insensitive ? foldAsciiCp(cp) === foldAsciiCp(inst.cp) : cp === inst.cp) nextOut = inst.out;
        } else if (inst.op === "dot") {
          if ((inst.dotall || cp !== 10) && (inst.nullData || cp !== 0)) nextOut = inst.out;
        } else if (inst.op === "class") {
          if (evalClassNode(inst.node, cp)) nextOut = inst.out;
        }
        if (nextOut >= 0) {
          clistStates[clistLen] = nextOut;
          clistStarts[clistLen] = startPos;
          clistLen++;
        }
      }
      if (matchedStart >= 0 && clistLen === 0) {
        return { start: matchedStart, end: matchedEnd };
      }
    }

    return matchedStart >= 0 ? { start: matchedStart, end: matchedEnd } : undefined;
  }

  matchBytes(bytes: Uint8Array, all: boolean): Match[] {
    const subject = decodeUtf8Subject(bytes);
    const matches: Match[] = [];
    let cursor = 0;
    let prevEnd = -1;
    while (cursor <= subject.length) {
      const minEnd = cursor === prevEnd ? cursor + 1 : cursor;
      const found = this.findNext(subject, cursor, minEnd);
      if (!found) break;
      matches.push({
        start: subject.offsets[found.start]!,
        end: subject.offsets[found.end]!,
      });
      if (!all) break;
      prevEnd = found.end;
      cursor = found.end > found.start ? found.end : found.end + 1;
    }
    return matches;
  }

  batchSync(rows: readonly Row[]): Match[][] {
    const out: Match[][] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      out[i] = this.matchBytes(row.bytes, row.all);
    }
    return out;
  }
}

function buildFixedAst(pattern: string, insensitive: boolean): AstNode {
  const children: AstNode[] = [];
  for (let i = 0; i < pattern.length;) {
    const cp = pattern.codePointAt(i)!;
    children.push({ type: "literal", cp, insensitive });
    i += String.fromCodePoint(cp).length;
  }
  if (children.length === 0) return { type: "empty" };
  if (children.length === 1) return children[0]!;
  return { type: "seq", children };
}

const preparedRegexCache = new Map<string, PreparedErgonomicRegex>();
const MAX_PREPARED_REGEX_CACHE = 256;

export function prepareErgonomicRegex(
  patterns: readonly string[],
  config: ErgonomicRegexConfig,
): PreparedErgonomicRegex {
  const cacheKey = `${config.kind}\0${config.extended ? 1 : 0}\0${config.fixed ? 1 : 0}\0${config.caseMode}\0${config.multiline ? 1 : 0}\0${config.multilineDotall ? 1 : 0}\0${config.word ? 1 : 0}\0${config.whole ? 1 : 0}\0${config.nullData ? 1 : 0}\0${patterns.join("\u0001")}`;
  const cached = preparedRegexCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const multiline = Boolean(config.multiline);
  const dotall = Boolean(config.multilineDotall);
  const bre = config.kind === "grep" && !config.extended;

  if (patterns.length === 0) {
    return { mode: "delegated", patterns: [], extended: Boolean(config.extended) };
  }

  if (config.fixed) {
    const hasNewline = patterns.some(p => p.includes("\n"));
    if (!multiline && hasNewline) {
      throw new SearchError("literal newline in pattern requires --multiline (-U)");
    }
    if (multiline && hasNewline) {
      const branches: AstNode[] = patterns.map(p => {
        const hasUpper = /[A-Z]/u.test(p);
        const insensitive = config.caseMode === "insensitive" || (config.caseMode === "smart" && !hasUpper);
        return buildFixedAst(p, insensitive);
      });
      let root: AstNode = branches.length === 1 ? branches[0]! : { type: "alt", branches };
      if (config.whole) root = { type: "seq", children: [{ type: "assert", kind: "bol" }, root, { type: "assert", kind: "eol" }] };
      else if (config.word) root = { type: "seq", children: [{ type: "assert", kind: "bow" }, root, { type: "assert", kind: "eow" }] };
      return { mode: "vm", vm: new ErgonomicVmMatcher(root, true), crossLine: true };
    }
    return { mode: "delegated", patterns, extended: Boolean(config.extended) };
  }

  const translated: string[] = [];
  const branches: AstNode[] = [];
  let anyNeedsVm = false;
  let anyCrossLine = false;

  for (const pat of patterns) {
    const provisionalInsensitive = config.caseMode === "insensitive";
    const firstParse = parsePattern(pat, bre, provisionalInsensitive, multiline, dotall, config.nullData);
    const effectiveInsensitive =
      config.caseMode === "insensitive" || (config.caseMode === "smart" && !firstParse.hasUppercaseLiteral);
    const outcome =
      effectiveInsensitive !== provisionalInsensitive
        ? parsePattern(pat, bre, effectiveInsensitive, multiline, dotall, config.nullData)
        : firstParse;

    translated.push(outcome.translatedEre);
    branches.push(outcome.ast);
    if (outcome.needsVm) anyNeedsVm = true;
    if (outcome.hasCrossLinePotential) anyCrossLine = true;
  }

  let result: PreparedErgonomicRegex;
  if (!anyNeedsVm) {
    result = {
      mode: "delegated",
      patterns: translated,
      extended: true,
    };
  } else {
    let root: AstNode = branches.length === 1 ? branches[0]! : { type: "alt", branches };
    if (config.whole) {
      root = { type: "seq", children: [{ type: "assert", kind: "bol" }, root, { type: "assert", kind: "eol" }] };
    } else if (config.word) {
      root = { type: "seq", children: [{ type: "assert", kind: "bow" }, root, { type: "assert", kind: "eow" }] };
    }
    result = {
      mode: "vm",
      vm: new ErgonomicVmMatcher(root, multiline),
      crossLine: multiline && anyCrossLine,
    };
  }
  if (preparedRegexCache.size >= MAX_PREPARED_REGEX_CACHE) {
    const firstKey = preparedRegexCache.keys().next().value;
    if (firstKey !== undefined) preparedRegexCache.delete(firstKey);
  }
  preparedRegexCache.set(cacheKey, result);
  return result;
}
