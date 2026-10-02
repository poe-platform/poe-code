import { decodeByteText, encodeByteText, byteTextPosition, type DecodedByteText } from "./byte-text.js";
import { Budget, ProgramError } from "./budget.js";
import { ReplacementBuffer } from "./replacement-buffer.js";
import type { RegexNode as Node } from "./regex-syntax.js";
import { parseRustPattern } from "./rust-syntax.js";

function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function matchesBoundary(instruction: Extract<Instruction, { kind: "boundary" }>, text: string, position: number): boolean {
  const before = position > 0 && instruction.accepts(text[position - 1]!);
  const after = position < text.length && instruction.accepts(text[position]!);
  const boundary = instruction.edge === "start" ? !before && after : instruction.edge === "end" ? before && !after : before !== after;
  return boundary === instruction.positive;
}

type Instruction = { kind: "character"; literal?: string; accepts: (character: string) => boolean }
  | { kind: "backreference"; index: number; ignoreCase: boolean; fold?: (text: string) => string }
  | { kind: "assertion"; first: number; next: number; positive: boolean; behind: boolean }
  | { kind: "atomic"; first: number; next: number }
  | { kind: "conditional"; first: number; yes: number; no: number }
  | { kind: "captureSet"; index: number }
  | { kind: "continue" }
  | { kind: "boundary"; accepts: (character: string) => boolean; positive: boolean; edge?: "start" | "end" }
  | { kind: "begin" | "end"; multiline?: boolean; strict?: boolean; trailingNewlines?: boolean }
  | { kind: "match" }
  | { kind: "save"; slot: number; clearUntil?: number }
  | { kind: "jump"; target: number }
  | { kind: "split"; first: number; second: number };

function instructionCounts(root: Node): Map<Node, number> {
  const counts = new Map<Node, number>();
  const pending: { node: Node; visited: boolean }[] = [{ node: root, visited: false }];
  while (pending.length) {
    const { node, visited } = pending.pop()!;
    if (!visited) {
      pending.push({ node, visited: true });
      if (node.type === "group" || node.type === "assertion" || node.type === "repeat" || node.type === "atomic")
        pending.push({ node: node.node, visited: false });
      else if (node.type === "conditional") {
        pending.push({ node: node.no, visited: false }, { node: node.yes, visited: false }, { node: node.condition, visited: false });
      }
      else if (node.type === "sequence" || node.type === "alternate")
        for (let index = node.nodes.length - 1; index >= 0; index--)
          pending.push({ node: node.nodes[index]!, visited: false });
      continue;
    }
    let size: number;
    if (node.type === "empty") size = 0;
    else if (node.type === "group" || node.type === "assertion" || node.type === "atomic") size = 2 + counts.get(node.node)!;
    else if (node.type === "conditional") size = 3 + counts.get(node.condition)! + counts.get(node.yes)! + counts.get(node.no)!;
    else if (node.type === "sequence" || node.type === "alternate") {
      size = node.type === "alternate" ? 2 * (node.nodes.length - 1) : 0;
      for (const child of node.nodes) size += counts.get(child)!;
      // Remove empty sequence work once, before enclosing repetitions amplify it.
      if (node.type === "sequence") node.nodes = node.nodes.filter(child => counts.get(child)! > 0);
    } else if (node.type === "repeat") {
      const child = counts.get(node.node)!;
      size = node.maximum === 0 ? 0 : node.maximum === Infinity ? child * (node.minimum + 1) + 2
        : child * node.maximum + node.maximum - node.minimum;
    } else size = 1;
    // Preserve an overflow marker until enclosing zero repetitions discard it.
    counts.set(node, Number.isSafeInteger(size) ? size : Infinity);
  }
  return counts;
}

function* compileProgram(root: Node, counts: Map<Node, number>, ignoreCase: boolean): Generator<void, Instruction[]> {
  const code: Instruction[] = [];
  const emit = (instruction: Instruction): number => code.push(instruction) - 1;
  interface Frame { node: Node; index: number; start?: number | undefined; awaiting?: boolean; jumps?: number[]; jump?: number }
  const pending: Frame[] = [{ node: root, index: 0 }];
  while (pending.length) {
    const frame = pending[pending.length - 1]!;
    const node = frame.node;
    if (counts.get(node) === 0) { pending.pop(); continue; }
    yield;
    if (node.type === "sequence") {
      if (frame.index < node.nodes.length) pending.push({ node: node.nodes[frame.index++]!, index: 0 });
      else pending.pop();
    } else if (node.type === "group") {
      if (frame.index++ === 0) {
        emit({ kind: "save", slot: node.index * 2,
          ...(node.lastCapture > node.index ? { clearUntil: (node.lastCapture + 1) * 2 } : {}) });
        pending.push({ node: node.node, index: 0 });
      } else { emit({ kind: "save", slot: node.index * 2 + 1 }); pending.pop(); }
    } else if (node.type === "conditional") {
      if (frame.index === 0) {
        frame.start = emit({ kind: "conditional", first: code.length + 1, yes: 0, no: 0 });
        frame.index = 1;
        pending.push({ node: node.condition, index: 0 });
      } else if (frame.index === 1) {
        emit({ kind: "match" });
        (code[frame.start!] as Extract<Instruction, { kind: "conditional" }>).yes = code.length;
        frame.index = 2;
        pending.push({ node: node.yes, index: 0 });
      } else if (frame.index === 2) {
        frame.jump = emit({ kind: "jump", target: 0 });
        (code[frame.start!] as Extract<Instruction, { kind: "conditional" }>).no = code.length;
        frame.index = 3;
        pending.push({ node: node.no, index: 0 });
      } else {
        (code[frame.jump!] as Extract<Instruction, { kind: "jump" }>).target = code.length;
        pending.pop();
      }
    } else if (node.type === "assertion" || node.type === "atomic") {
      if (frame.index++ === 0) {
        frame.start = emit(node.type === "assertion"
          ? { kind: "assertion", first: code.length + 1, next: 0, positive: node.positive, behind: node.behind }
          : { kind: "atomic", first: code.length + 1, next: 0 });
        pending.push({ node: node.node, index: 0 });
      } else {
        emit({ kind: "match" });
        (code[frame.start!] as Extract<Instruction, { kind: "assertion" | "atomic" }>).next = code.length;
        pending.pop();
      }
    } else if (node.type === "alternate") {
      if (frame.awaiting) {
        if (frame.index < node.nodes.length) {
          (frame.jumps ??= []).push(emit({ kind: "jump", target: 0 }));
          (code[frame.start!] as Extract<Instruction, { kind: "split" }>).second = code.length;
        }
        frame.awaiting = false;
      }
      if (frame.index === node.nodes.length) {
        for (const jump of frame.jumps ?? []) (code[jump] as Extract<Instruction, { kind: "jump" }>).target = code.length;
        pending.pop();
      } else {
        if (frame.index < node.nodes.length - 1) frame.start = emit({ kind: "split", first: code.length + 1, second: 0 });
        frame.awaiting = true;
        pending.push({ node: node.nodes[frame.index++]!, index: 0 });
      }
    } else if (node.type === "repeat") {
      if (frame.start !== undefined) {
        if (node.maximum === Infinity) emit({ kind: "jump", target: frame.start });
        const split = code[frame.start] as Extract<Instruction, { kind: "split" }>;
        split.second = code.length;
        if (node.lazy) [split.first, split.second] = [split.second, split.first];
        frame.start = undefined;
        if (node.maximum === Infinity) { pending.pop(); continue; }
      }
      if (counts.get(node.node) === 0) frame.index = Math.max(frame.index, node.minimum);
      if (frame.index < node.minimum) {
        frame.index++;
        pending.push({ node: node.node, index: 0 });
      } else if (frame.index < node.maximum) {
        frame.index++;
        frame.start = emit({ kind: "split", first: code.length + 1, second: 0 });
        pending.push({ node: node.node, index: 0 });
      } else pending.pop();
    } else {
      if (node.type === "character") emit({ kind: "character", ...(node.literal !== undefined ? { literal: node.literal } : {}), accepts: node.accepts });
      else if (node.type === "backreference") emit({ kind: "backreference", index: node.index, ignoreCase: node.ignoreCase ?? ignoreCase, ...(node.fold ? { fold: node.fold } : {}) });
      else if (node.type === "boundary") emit({ kind: "boundary", accepts: node.accepts, positive: node.positive, ...(node.edge ? { edge: node.edge } : {}) });
      else if (node.type === "continue") emit({ kind: "continue" });
      else if (node.type === "reset") emit({ kind: "save", slot: 0 });
      else if (node.type === "captureSet") emit({ kind: "captureSet", index: node.index });
      else if (node.type === "begin" || node.type === "end") emit({ kind: node.type, ...(node.multiline === undefined ? {} : { multiline: node.multiline }), ...(node.strict === undefined ? {} : { strict: node.strict }), ...(node.trailingNewlines ? { trailingNewlines: true } : {}) });
      else throw new ProgramError("invalid internal regular expression node");
      pending.pop();
    }
  }
  emit({ kind: "match" });
  return code;
}

const classes: Record<string, (character: string) => boolean> = {
  alpha: character => /^[A-Za-z]$/u.test(character),
  alnum: character => /^[A-Za-z0-9]$/u.test(character),
  digit: character => /^[0-9]$/u.test(character),
  lower: character => /^[a-z]$/u.test(character),
  upper: character => /^[A-Z]$/u.test(character),
  xdigit: character => /^[A-Fa-f0-9]$/u.test(character),
  space: character => /^[ \t\n\r\v\f]$/u.test(character),
  blank: character => character === " " || character === "\t",
  cntrl: character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  graph: character => character.charCodeAt(0) >= 33 && character.charCodeAt(0) <= 126,
  print: character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) <= 126,
  punct: character => /^[!-/:-@[-`{-~]$/u.test(character),
};

function extendedSource(source: string): string {
  let result = "";
  let bracket = false;
  let bracketFirst = false;
  for (let offset = 0; offset < source.length; offset++) {
    const character = source[offset]!;
    if (!bracket && character === "\\" && offset + 1 < source.length) {
      const next = source[++offset]!;
      if (next === "(" && source.startsWith("?:", offset + 1)) {
        result += "(?:";
        offset += 2;
      } else result += "()|+?{}".includes(next) ? next : `\\${next}`;
    } else if (bracket) {
      if (bracketFirst && character === "^") {
        result += character;
        continue;
      }
      if (bracketFirst && character === "]") {
        result += character;
        bracketFirst = false;
        continue;
      }
      bracketFirst = false;
      if (character === "[" && (source[offset + 1] === ":" || source[offset + 1] === "." || source[offset + 1] === "=")) {
        const kind = source[offset + 1]!;
        const close = source.indexOf(`${kind}]`, offset + 2);
        if (close >= 0) {
          result += source.slice(offset, close + 2);
          offset = close + 1;
          continue;
        }
      }
      if (character === "]") bracket = false;
      result += character;
    } else {
      if (character === "[") { bracket = true; bracketFirst = true; }
      result += "()|+?{}".includes(character) ? `\\${character}` : character;
    }
  }
  return result;
}

export interface PatternLimits {
  readonly maxPatternInstructions?: number;
  readonly maxPatternSource?: number;
  readonly maxPatternDepth?: number;
}

export interface Match { readonly start: number; readonly end: number; readonly groups: readonly (string | undefined)[]; readonly captureOffsets?: readonly (number | undefined)[] }

type PatternBudget = Pick<Budget, "step" | "maxBufferBytes"> & { readonly options?: PatternLimits } & Partial<Pick<Budget, "checkpointSync">> & {
  checkpoint(): void | Promise<void>;
};

type ChainStep =
  | { readonly kind: "literal"; value: string; readonly group: number }
  | { readonly kind: "char"; readonly accepts: (candidate: string) => boolean; readonly ascii: Uint8Array; readonly group: number }
  | { readonly kind: "repeat"; readonly minimum: number; readonly accepts: (candidate: string) => boolean; readonly ascii: Uint8Array; readonly group: number };

interface ChainMatch {
  readonly prefix: string;
  readonly anchoredStart: boolean;
  readonly anchoredEnd: boolean;
  readonly steps: readonly ChainStep[];
}

function makeAsciiTable(accepts: (candidate: string) => boolean): Uint8Array {
  const ascii = new Uint8Array(128);
  for (let c = 0; c < 128; c++) {
    if (accepts(String.fromCharCode(c))) ascii[c] = 1;
  }
  return ascii;
}

function buildChainMatch(root: Node, groupCount: number): ChainMatch | undefined {
  if (root.type !== "sequence" || groupCount > 9) return undefined;
  let startIdx = 0;
  let endIdx = root.nodes.length;
  let anchoredStart = false;
  let anchoredEnd = false;
  if (startIdx < endIdx && root.nodes[startIdx]?.type === "begin") {
    anchoredStart = true;
    startIdx++;
  }
  if (startIdx < endIdx && root.nodes[endIdx - 1]?.type === "end") {
    anchoredEnd = true;
    endIdx--;
  }
  if (startIdx >= endIdx) return undefined;
  const steps: ChainStep[] = [];
  let hasRepeat = false;
  for (let i = startIdx; i < endIdx; i++) {
    let n = root.nodes[i]!;
    let group = 0;
    if (n.type === "group") {
      group = n.index;
      n = n.node.type === "sequence" && n.node.nodes.length === 1 ? n.node.nodes[0]! : n.node;
    }
    if (n.type === "character") {
      if (n.literal !== undefined) {
        const prev = steps[steps.length - 1];
        if (group === 0 && prev && prev.kind === "literal" && prev.group === 0) {
          prev.value += n.literal;
        } else {
          steps.push({ kind: "literal", value: n.literal, group });
        }
      } else {
        steps.push({ kind: "char", accepts: n.accepts, ascii: makeAsciiTable(n.accepts), group });
      }
    } else if (
      n.type === "repeat" &&
      n.minimum >= 0 &&
      n.maximum === Infinity &&
      !n.lazy &&
      n.node.type === "character"
    ) {
      hasRepeat = true;
      steps.push({ kind: "repeat", minimum: n.minimum, accepts: n.node.accepts, ascii: makeAsciiTable(n.node.accepts), group });
    } else {
      return undefined;
    }
  }
  const first = steps[0];
  if (!first) return undefined;
  const hasLiteralPrefix = first.kind === "literal" && first.value.length > 0;
  const hasRepeatHead = first.kind === "repeat" && first.minimum >= 1;
  if (!hasLiteralPrefix && !hasRepeatHead) return undefined;
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s]!;
    if (step.kind === "repeat") {
      if (s < steps.length - 1) {
        const next = steps[s + 1]!;
        if (next.kind !== "literal" || next.value.length === 0 || step.accepts(next.value[0]!)) return undefined;
      }
      if (!anchoredStart && hasLiteralPrefix) {
        for (let k = 0; k < first.value.length; k++) {
          if (step.accepts(first.value[k]!)) return undefined;
        }
      }
    }
  }
  if (!hasRepeat && steps.length < 2) return undefined;
  return { prefix: hasLiteralPrefix ? first.value : "", anchoredStart, anchoredEnd, steps };
}

function matchChainAt(
  steps: readonly ChainStep[],
  prefixLen: number,
  anchoredEnd: boolean,
  text: string,
  startPos: number,
  outOffsets: Int32Array,
  groupCount: number,
  textEnd = text.length,
  startStep = 1,
): number {
  for (let g = 1; g <= groupCount; g++) {
    outOffsets[g * 2] = -1;
    outOffsets[g * 2 + 1] = -1;
  }
  let cursor = startStep === 1 ? startPos + prefixLen : startPos;
  for (let s = startStep; s < steps.length; s++) {
    const step = steps[s]!;
    const stepStart = cursor;
    if (step.kind === "literal") {
      const val = step.value;
      if (cursor + val.length > textEnd) return -1;
      for (let k = 0; k < val.length; k++) {
        if (text.charCodeAt(cursor + k) !== val.charCodeAt(k)) return -1;
      }
      cursor += val.length;
    } else if (step.kind === "char") {
      if (cursor >= textEnd) return -1;
      const code = text.codePointAt(cursor)!;
      if (code < 128 ? step.ascii[code] === 0 : !step.accepts(String.fromCodePoint(code))) return -1;
      cursor += code > 0xffff ? 2 : 1;
    } else {
      let count = 0;
      while (cursor < textEnd) {
        const code = text.codePointAt(cursor)!;
        if (code < 128 ? step.ascii[code] === 0 : !step.accepts(String.fromCodePoint(code))) break;
        cursor += code > 0xffff ? 2 : 1;
        count++;
      }
      if (count < step.minimum) return -1;
    }
    if (step.group > 0) {
      outOffsets[step.group * 2] = stepStart;
      outOffsets[step.group * 2 + 1] = cursor;
    }
  }
  if (anchoredEnd && cursor !== textEnd) return -1;
  outOffsets[0] = startPos;
  outOffsets[1] = cursor;
  return cursor;
}

class NfaStorage {
  private used = 0;
  constructor(private readonly budget: PatternBudget) {}
  reserve(bytes: number): void {
    this.budget.step(0);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.budget.maxBufferBytes - this.used) {
      throw new ProgramError("regular expression state buffer limit exceeded");
    }
    this.used += bytes;
  }
  release(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.used) throw new ProgramError("invalid regular expression state accounting");
    this.used -= bytes;
  }
  clear(): void { this.used = 0; }
}

export class Pattern {
  readonly groupCount: number;
  readonly groupNames = new Map<string, number>();
  private code: Instruction[] = [];
  private compiledSteps = 0;
  private sourceLength = 0;
  private patternDepth = 0;
  private readonly instructionCount: number;
  private budgetPrepared = false;
  private parsed: { root: Node; counts: Map<Node, number> } | undefined;
  private readonly anchored: boolean;
  private linear = false;
  private literalMatch: { readonly value: string; readonly anchoredStart: boolean; readonly anchoredEnd: boolean; readonly groups: readonly [string] } | undefined;
  private simpleRepeatMatch: {
    readonly prefix: string;
    readonly anchoredStart: boolean;
    readonly anchoredEnd: boolean;
    readonly captured: boolean;
    readonly minimum: number;
    readonly accepts: (candidate: string) => boolean;
    readonly ascii: Uint8Array;
  } | undefined;
  private chainMatch: ChainMatch | undefined;
  private backreferences = false;
  private trailingNewlineAnchor = false;
  private fastPrefixInfo: { readonly anchoredStart: boolean; readonly anchoredEnd: boolean; readonly prefix: string } | undefined;

  constructor(source: string, extended = true, private readonly ignoreCase = false, private readonly dialect: "sed" | "awk" | "jq" | "rust" = "sed", private readonly modifiers = "", limits: PatternLimits = {}) {
    this.sourceLength = source.length;
    const prefix = dialect === "jq" || dialect === "rust" ? dialect + " " : "";
    const maximumInstructions = limits.maxPatternInstructions ?? Infinity;
    if ([maximumInstructions, limits.maxPatternSource ?? Infinity, limits.maxPatternDepth ?? Infinity].some(value => value !== Infinity && (!Number.isSafeInteger(value) || value < 1))) throw new ProgramError("limits must be positive safe integers");
    if (source.length > (limits.maxPatternSource ?? Infinity)) throw new ProgramError(`${prefix}regular expression source limit exceeded`);
    if (dialect === "rust") {
      const parsed = parseRustPattern(source, ignoreCase, limits.maxPatternDepth), counts = instructionCounts(parsed.root);
      if (!Number.isSafeInteger(counts.get(parsed.root)! + 1) || counts.get(parsed.root)! + 1 > maximumInstructions) throw new ProgramError(`${prefix}regular expression program limit exceeded`);
      this.patternDepth = parsed.depth;
      this.instructionCount = counts.get(parsed.root)! + 1;
      this.groupCount = parsed.groupCount;
      for (const [name, index] of parsed.groupNames) this.groupNames.set(name, index);
      this.anchored = false;
      this.parsed = { root: parsed.root, counts };
      return;
    }
    if (!extended) source = extendedSource(source);
    let offset = 0;
    let groups = 0;
    const closedGroups = new Set<number>();
    let insensitive = ignoreCase;
    let multiline = false;
    let dotAll = dialect !== "jq" || modifiers.includes("m");
    const characterNode = (character: string): Node => {
      const fold = insensitive;
      return { type: "character", ...(fold ? {} : { literal: character }),
        accepts: candidate => fold ? candidate.toLowerCase() === character.toLowerCase() : candidate === character };
    };
    const shorthand = (reference: string): ((character: string) => boolean) => {
      const alphabet = reference.toLowerCase();
      return character => {
        const accepted = alphabet === "d" ? character >= "0" && character <= "9"
          : alphabet === "s" ? " \t\n\r\f\v".includes(character)
          : isWordChar(character);
        return reference === alphabet ? accepted : !accepted;
      };
    };
    const escaped = (): string => {
      const character = offset < source.length ? String.fromCodePoint(source.codePointAt(offset)!) : undefined;
      offset += character?.length ?? 1;
      if (character === undefined) throw new ProgramError("trailing backslash in regular expression");
      if (dialect === "awk") {
        const octal = "01234567".includes(character);
        if (octal || character === "x") {
          let digits = octal ? character : "";
          const alphabet = octal ? "01234567" : "0123456789abcdefABCDEF";
          while (digits.length < (octal ? 3 : 2) && offset < source.length && alphabet.includes(source[offset]!)) digits += source[offset++];
          return digits ? String.fromCharCode(parseInt(digits, octal ? 8 : 16) & 255) : character;
        }
        if (character === "b") return "\b";
      }
      if (dialect === "sed" && /^[1-9]$/u.test(character)) throw new ProgramError("pattern backreferences are not supported");
      const control: Record<string, string> = { n: "\n", t: "\t", r: "\r", f: "\f", v: "\v", a: "\x07" };
      return control[character] ?? character;
    };
    const bracket = (): Node => {
      const negate = source[offset] === "^";
      if (negate) offset++;
      const tests: ((character: string) => boolean)[] = [];
      const fold = insensitive;
      let first = true;
      while (offset < source.length && (source[offset] !== "]" || first)) {
        first = false;
        if (source.startsWith("[:", offset)) {
          const end = source.indexOf(":]", offset + 2);
          const name = end < 0 ? "" : source.slice(offset + 2, end);
          if (!classes[name]) throw new ProgramError(`unsupported character class '${name}'`);
          tests.push(classes[name]!); offset = end + 2; continue;
        }
        if (source.startsWith("[.", offset) || source.startsWith("[=", offset)) throw new ProgramError("collating and equivalence classes are not supported");
        if (source[offset] === "\\" && "dDsSwW".includes(source[offset + 1] ?? " ")) {
          tests.push(shorthand(source[offset + 1]!));
          offset += 2;
          if (source[offset] === "-" && source[offset + 1] !== "]") throw new ProgramError("character class cannot be a range endpoint");
          continue;
        }
        const readBracketChar = (): string => {
          const ch = String.fromCodePoint(source.codePointAt(offset)!);
          offset += ch.length;
          if (ch !== "\\") return ch;
          if (dialect === "sed") {
            const next = source[offset];
            if (next === "\\" || next !== undefined && "ntrfva".includes(next)) return escaped();
            return "\\";
          }
          if (dialect === "awk" && source[offset] !== undefined && /^[1-9]$/u.test(source[offset]!)) {
            return escaped();
          }
          return escaped();
        };
        const start = readBracketChar();
        if (source[offset] === "-" && source[offset + 1] !== "]" && source[offset + 1] !== undefined) {
          offset++;
          if (source[offset] === "\\" && "dDsSwW".includes(source[offset + 1] ?? " ")) throw new ProgramError("character class cannot be a range endpoint");
          const end = readBracketChar();
          if (start > end) throw new ProgramError("reversed character range");
          tests.push(character => character >= start && character <= end);
        } else tests.push(character => character === start);
      }
      if (source[offset++] !== "]") throw new ProgramError("unterminated bracket expression");
      return { type: "character", accepts: character => {
        const accepted = tests.some(test => test(character) || fold && (test(character.toLowerCase()) || test(character.toUpperCase())));
        return negate ? !accepted : accepted;
      } };
    };
    const atom = (atStart: boolean, afterBegin: boolean): Node => {
      const token = offset < source.length ? String.fromCodePoint(source.codePointAt(offset)!) : source[offset];
      offset += token?.length ?? 1;
      if (token === "[") return bracket();
      if (token === "\\") {
        const reference = source[offset];
        if ((dialect === "sed" || dialect === "jq") && reference !== undefined && /^[1-9]$/u.test(reference)) {
          const index = Number(reference);
          if (!closedGroups.has(index)) throw new ProgramError("pattern references an undefined or open capture group");
          offset++;
          return { type: "backreference", index, ignoreCase: insensitive };
        }
        if (reference !== undefined && "bByY<>".includes(reference)) {
          offset++;
          if (dialect === "awk" && reference === "b") {
            return characterNode("\b");
          }
          return { type: "boundary", accepts: isWordChar, positive: reference !== "B" && reference !== "Y",
            ...(reference === "<" ? { edge: "start" as const } : reference === ">" ? { edge: "end" as const } : {}) };
        }
        if ((dialect === "jq" || dialect === "sed" || dialect === "awk") && reference !== undefined && "dDsSwW".includes(reference)) {
          offset++;
          return { type: "character", accepts: shorthand(reference) };
        }
        return characterNode(escaped());
      }
      if (token === ".") { const all = dotAll; return { type: "character", accepts: character => all || character !== "\n" }; }
      if (token === "^") return extended || atStart ? { type: "begin", multiline } : characterNode(token);
      if (token === "$") return extended || offset === source.length || source[offset] === ")" || source[offset] === "|" ? { type: "end", multiline } : characterNode(token);
      if (token === "*" && !extended && (atStart || afterBegin)) return characterNode(token);
      if (token === undefined || "*+?{}".includes(token)) throw new ProgramError("quantifier without an expression");
      return characterNode(token);
    };
    const repeated = (original: Node): Node => {
      let node = original;
      if (!extended && (node.type === "begin" || node.type === "end")) return node;
      const quantifier = source[offset];
      if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
        offset++;
        node = { type: "repeat", node, minimum: quantifier === "+" ? 1 : 0, maximum: quantifier === "?" ? 1 : Infinity };
      } else if (quantifier === "{") {
        const match = /^\{([0-9]+)(?:,([0-9]*))?\}/u.exec(source.slice(offset));
        if (!match) throw new ProgramError("invalid repetition interval");
        const minimum = Number(match[1]);
        const maximum = match[2] === undefined ? minimum : match[2] === "" ? Infinity : Number(match[2]);
        if (!Number.isSafeInteger(minimum) || maximum !== Infinity && !Number.isSafeInteger(maximum) || maximum < minimum) throw new ProgramError("invalid or excessive repetition interval");
        offset += match[0].length;
        node = { type: "repeat", node, minimum, maximum };
      }
      if (dialect === "jq" && node.type === "repeat" && source[offset] === "?") { node.lazy = true; offset++; }
      if (source[offset] !== undefined && "*+?{".includes(source[offset]!)) throw new ProgramError("nested quantifier is not supported");
      return node;
    };
    interface ParseFrame {
      nodes: Node[];
      alternatives: Node[];
      index: number;
      flags?: { insensitive: boolean; multiline: boolean; dotAll: boolean };
      assertion?: { positive: boolean; behind: boolean } | undefined;
    }
    const frames: ParseFrame[] = [{ nodes: [], alternatives: [], index: 0 }];
    const sequence = (nodes: Node[]): Node => nodes.length ? { type: "sequence", nodes } : { type: "empty" };
    const finish = (frame: ParseFrame): Node => {
      frame.alternatives.push(sequence(frame.nodes));
      return frame.alternatives.length === 1 ? frame.alternatives[0]! : { type: "alternate", nodes: frame.alternatives };
    };
    while (offset < source.length) {
      const frame = frames[frames.length - 1]!;
      if (source[offset] === "|") {
        offset++;
        frame.alternatives.push(sequence(frame.nodes));
        frame.nodes = [];
      } else if (source[offset] === ")") {
        if (frames.length === 1) throw new ProgramError("unmatched ')' in regular expression");
        offset++;
        const inner = finish(frame);
        frames.pop();
        if (frame.flags) ({ insensitive, multiline, dotAll } = frame.flags);
        closedGroups.add(frame.index);
        const node: Node = frame.assertion ? { type: "assertion", node: inner, ...frame.assertion }
          : frame.index ? { type: "group", index: frame.index, lastCapture: groups, node: inner } : inner;
        frames[frames.length - 1]!.nodes.push(repeated(node));
      } else if (source[offset] === "(") {
        if (frames.length > (limits.maxPatternDepth ?? Infinity)) throw new ProgramError(`${prefix}regular expression depth limit exceeded`);
        this.patternDepth = Math.max(this.patternDepth, frames.length);
        offset++;
        const flags = { insensitive, multiline, dotAll };
        if (dialect === "jq" && source[offset] === "?" && "ims-".includes(source[offset + 1] ?? " ")) {
          offset++;
          let enabled = true;
          let count = 0;
          while (offset < source.length && source[offset] !== ":" && source[offset] !== ")") {
            const flag = source[offset++]!;
            if (flag === "-" && enabled) { enabled = false; count = 0; continue; }
            if (flag === "i") insensitive = enabled;
            else if (flag === "m") multiline = enabled;
            else if (flag === "s") dotAll = enabled;
            else throw new ProgramError("unsupported inline regular expression flag");
            count++;
          }
          if (!count) throw new ProgramError("empty inline regular expression flags");
          if (source[offset] === ")") { offset++; continue; }
          if (source[offset++] !== ":") throw new ProgramError("unterminated inline regular expression flags");
          frames.push({ nodes: [], alternatives: [], index: 0, flags });
          continue;
        }
        let name: string | undefined;
        let capturing = true;
        let assertion: ParseFrame["assertion"];
        if (source[offset] === "?" && source[offset + 1] === ":") {
          offset += 2;
          capturing = false;
        } else if (dialect === "jq" && source[offset] === "?") {
          offset++;
          if (source[offset] === ":") { offset++; capturing = false; }
          else if (source[offset] === "=" || source[offset] === "!") {
            assertion = { positive: source[offset++] === "=", behind: false }; capturing = false;
          } else if (source[offset] === "<" && "=!".includes(source[offset + 1] ?? "")) {
            offset++;
            assertion = { positive: source[offset++] === "=", behind: true }; capturing = false;
          } else if (source[offset] === "<" && !"=!".includes(source[offset + 1] ?? "")) {
            const end = source.indexOf(">", ++offset);
            if (end < 0) throw new ProgramError("invalid named capture");
            name = source.slice(offset, end); offset = end + 1;
          } else throw new ProgramError("unsupported jq regular expression group");
        }
        const index = capturing ? ++groups : 0;
        if (name !== undefined) this.groupNames.set(name, index);
        frames.push({ nodes: [], alternatives: [], index, assertion, flags });
      } else {
        frame.nodes.push(repeated(atom(frame.nodes.length === 0, frame.nodes.length === 1 && frame.nodes[0]!.type === "begin")));
      }
    }
    if (frames.length !== 1) throw new ProgramError("unmatched '(' in regular expression");
    const root = finish(frames[0]!);
    this.groupCount = groups;
    this.anchored = root.type === "sequence" && root.nodes[0]?.type === "begin";
    const counts = instructionCounts(root);
    if (!Number.isSafeInteger(counts.get(root)! + 1)) throw new ProgramError(`${prefix}regular expression program size is not representable`);
    if (counts.get(root)! + 1 > maximumInstructions) throw new ProgramError(`${prefix}regular expression program limit exceeded`);
    this.instructionCount = counts.get(root)! + 1;
    this.parsed = { root, counts };
    if (counts.get(root)! <= 64) {
      this.compileFromParsedSync();
    }
  }

  private assertInstructionLimit(budget: Pick<PatternBudget, "options">): void {
    if (this.sourceLength > (budget.options?.maxPatternSource ?? Infinity)) throw new ProgramError("regular expression source limit exceeded");
    if (this.patternDepth > (budget.options?.maxPatternDepth ?? Infinity)) throw new ProgramError("regular expression depth limit exceeded");
    if (this.instructionCount > (budget.options?.maxPatternInstructions ?? Infinity)) throw new ProgramError(`${this.dialect === "jq" ? "jq " : ""}regular expression program limit exceeded`);
  }

  private compileFromParsedSync(): void {
    if (!this.parsed) return;
    const { root, counts } = this.parsed;
    this.compiledSteps = counts.get(root)! + 1;
    const compilation = compileProgram(root, counts, this.ignoreCase);
    let result = compilation.next();
    while (!result.done) result = compilation.next();
    this.finalizeCompiledCode(result.value, root);
  }

  async prepare(budget: Pick<PatternBudget, "step" | "checkpoint" | "checkpointSync" | "options">): Promise<void> {
    this.assertInstructionLimit(budget);
    if (!this.parsed) {
      if (!this.budgetPrepared && this.compiledSteps > 0) {
        budget.step(this.compiledSteps);
        const pending = budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint();
        if (pending) await pending;
        this.budgetPrepared = true;
      }
      return;
    }
    const { root, counts } = this.parsed;
    budget.step(counts.get(root)! + 1);
    await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    // Each preparation owns its program until every branch is patched and the
    // final checkpoint succeeds. Cancellation leaves the parsed tree reusable.
    const compilation = compileProgram(root, counts, this.ignoreCase);
    let result = compilation.next();
    let work = 0;
    while (!result.done) {
      if (++work % 64 === 0) {
        await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
        budget.step(0);
      }
      result = compilation.next();
    }
    await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    budget.step(0);
    this.budgetPrepared = true;
    this.finalizeCompiledCode(result.value, root);
  }

  private finalizeCompiledCode(code: Instruction[], root: Node): void {
    this.linear = code.every(instruction => instruction.kind === "character" || instruction.kind === "begin" || instruction.kind === "end" || instruction.kind === "match");
    if (this.linear && !this.ignoreCase && this.dialect !== "jq" && this.dialect !== "rust") {
      let validLiteral = true;
      let anchoredStart = false;
      let anchoredEnd = false;
      let literalValue = "";
      for (let i = 0; i < code.length - 1; i++) {
        const inst = code[i]!;
        if (inst.kind === "begin") {
          if (i === 0) anchoredStart = true;
          else { validLiteral = false; break; }
        } else if (inst.kind === "end") {
          if (i === code.length - 2) anchoredEnd = true;
          else { validLiteral = false; break; }
        } else if (inst.kind === "character" && inst.literal !== undefined) {
          literalValue += inst.literal;
        } else {
          validLiteral = false;
          break;
        }
      }
      if (validLiteral) {
        this.literalMatch = { value: literalValue, anchoredStart, anchoredEnd, groups: [literalValue] };
        this.fastPrefixInfo = { anchoredStart, anchoredEnd, prefix: literalValue };
      }
    } else if (!this.ignoreCase && this.dialect !== "jq" && this.dialect !== "rust" && root.type === "sequence" && this.groupCount <= 1) {
      let startIdx = 0;
      let endIdx = root.nodes.length;
      let anchoredStart = false;
      let anchoredEnd = false;
      if (startIdx < endIdx && root.nodes[startIdx]?.type === "begin") {
        anchoredStart = true;
        startIdx++;
      }
      if (startIdx < endIdx && root.nodes[endIdx - 1]?.type === "end") {
        anchoredEnd = true;
        endIdx--;
      }
      if (startIdx < endIdx) {
        let prefix = "";
        let prefixValid = true;
        for (let i = startIdx; i < endIdx - 1; i++) {
          const n = root.nodes[i]!;
          if (n.type === "character" && n.literal !== undefined) {
            prefix += n.literal;
          } else {
            prefixValid = false;
            break;
          }
        }
        const tail = root.nodes[endIdx - 1]!;
        const captured = tail.type === "group" && tail.index === 1 && this.groupCount === 1;
        const rawInner = captured ? tail.node : this.groupCount === 0 ? tail : undefined;
        const repeatNode = rawInner?.type === "sequence" && rawInner.nodes.length === 1 ? rawInner.nodes[0] : rawInner;
        if (
          prefixValid &&
          repeatNode?.type === "repeat" &&
          (repeatNode.minimum >= 1 || prefix.length > 0 || anchoredStart) &&
          repeatNode.maximum === Infinity &&
          !repeatNode.lazy &&
          repeatNode.node.type === "character"
        ) {
          const acceptsFn = repeatNode.node.accepts;
          const ascii = new Uint8Array(128);
          for (let c = 0; c < 128; c++) {
            if (acceptsFn(String.fromCharCode(c))) ascii[c] = 1;
          }
          this.simpleRepeatMatch = {
            prefix,
            anchoredStart,
            anchoredEnd,
            captured,
            minimum: repeatNode.minimum,
            accepts: acceptsFn,
            ascii,
          };
          if (anchoredStart || prefix.length > 0) {
            this.fastPrefixInfo = { anchoredStart, anchoredEnd, prefix };
          }
        }
      }
    }
    if (!this.ignoreCase && this.dialect !== "jq" && this.dialect !== "rust" && !this.literalMatch && !this.simpleRepeatMatch) {
      const cm = buildChainMatch(root, this.groupCount);
      if (cm) {
        this.chainMatch = cm;
        this.fastPrefixInfo = { anchoredStart: cm.anchoredStart, anchoredEnd: cm.anchoredEnd, prefix: cm.prefix };
      }
    }
    this.backreferences = code.some(instruction => instruction.kind === "backreference");
    this.trailingNewlineAnchor = code.some(instruction => instruction.kind === "end" && instruction.trailingNewlines);
    this.code = code;
    this.parsed = undefined;
  }

  private async findJq(text: string, budget: PatternBudget, from: number,
    options: { pc: number; exact?: boolean; end?: number; captures?: number[]; continuation?: number } = { pc: 0 }): Promise<{ match: Match; captures: number[] } | undefined> {
    const continuation = options.continuation ?? from;
    let trailingStart = text.length;
    if (this.trailingNewlineAnchor) while (trailingStart > 0 && text[trailingStart - 1] === "\n") {
      budget.step(); trailingStart--;
      if (trailingStart % 64 === 0) await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    }
    // Prioritized traversal gives jq's leftmost-first (rather than POSIX longest) match.
    for (let start = from; start <= (options.end ?? text.length) && (!options.exact || start === from); start += (text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1) {
      const pending = [{ pc: options.pc, position: start, captures: options.captures ?? [] }];
      const visited = new Set<string>();
      let storage = 0;
      let checkpoints = 0;
      while (pending.length) {
        if (++checkpoints % 64 === 1) await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
        budget.step();
        const state = pending.pop()!;
        if (options.end !== undefined && state.position > options.end) continue;
        const key = `${state.pc}:${state.position}:${state.captures.join(",")}`;
        if (visited.has(key)) continue;
        storage += key.length * 2 + 64;
        if (storage > budget.maxBufferBytes) throw new ProgramError("regular expression state buffer limit exceeded");
        visited.add(key);
        const instruction = this.code[state.pc]!;
        const { position, captures } = state;
        const push = (pc: number, next = position, saved = captures): void => {
          if ((pending.length + 1) * (64 + (this.groupCount + 1) * 16) + storage > budget.maxBufferBytes) throw new ProgramError("regular expression state buffer limit exceeded");
          pending.push({ pc, position: next, captures: saved });
        };
        if (instruction.kind === "match") {
          if (options.end !== undefined && position !== options.end) continue;
          if (this.modifiers.includes("n") && position === start) continue;
          const matchStart = captures[0] ?? start;
          const groups: (string | undefined)[] = [text.slice(matchStart, position)];
          for (let index = 1; index <= this.groupCount; index++) {
            budget.step();
            groups.push(captures[index * 2] === undefined ? undefined : text.slice(captures[index * 2], captures[index * 2 + 1]));
          }
          return { match: { start: matchStart, end: position, groups, captureOffsets: captures }, captures };
        }
        if (instruction.kind === "conditional") {
          const result = await this.findJq(text, budget, position, { pc: instruction.first, exact: true, captures, continuation });
          if (result) push(instruction.yes, result.match.end, result.captures);
          else push(instruction.no);
        }
        else if (instruction.kind === "atomic") {
          const result = await this.findJq(text, budget, position, { pc: instruction.first, exact: true, captures, continuation });
          if (result) push(instruction.next, result.match.end, result.captures);
        }
        else if (instruction.kind === "assertion") {
          const result = await this.findJq(text, budget, instruction.behind ? 0 : position,
            instruction.behind ? { pc: instruction.first, end: position, captures, continuation }
              : { pc: instruction.first, exact: true, captures, continuation });
          if (Boolean(result) === instruction.positive) push(instruction.next, position, result?.captures ?? captures);
        }
        else if (instruction.kind === "jump") push(instruction.target);
        else if (instruction.kind === "split") { push(instruction.second); push(instruction.first); }
        else if (instruction.kind === "save") {
          const saved = [...captures];
          for (let slot = instruction.slot + 2; slot < Math.min(instruction.clearUntil ?? 0, saved.length); slot++) delete saved[slot];
          saved[instruction.slot] = position;
          push(state.pc + 1, position, saved);
        }
        else if (instruction.kind === "continue") { if (position === continuation) push(state.pc + 1); }
        else if (instruction.kind === "captureSet") { if (captures[instruction.index * 2] !== undefined) push(state.pc + 1); }
        else if (instruction.kind === "begin") { if (position === 0 || instruction.multiline && text[position - 1] === "\n") push(state.pc + 1); }
        else if (instruction.kind === "end") { if (position === text.length || instruction.trailingNewlines && position >= trailingStart || (instruction.multiline || !instruction.strict && position === text.length - 1) && text[position] === "\n") push(state.pc + 1); }
        else if (instruction.kind === "boundary") {
          const previous = position > 1 && text.codePointAt(position - 2)! > 0xffff ? text.slice(position - 2, position) : text.slice(position - 1, position);
          const next = text.codePointAt(position), current = next === undefined ? "" : String.fromCodePoint(next);
          const before = position > 0 && instruction.accepts(previous), after = Boolean(current) && instruction.accepts(current);
          const boundary = instruction.edge === "start" ? !before && after : instruction.edge === "end" ? before && !after : before !== after;
          if (boundary === instruction.positive) push(state.pc + 1);
        }
        else if (instruction.kind === "character") {
          const code = text.codePointAt(position);
          if (code !== undefined) { const character = String.fromCodePoint(code); if (instruction.accepts(character)) push(state.pc + 1, position + character.length); }
        } else if (instruction.kind === "backreference") {
          const begin = captures[instruction.index * 2];
          const end = captures[instruction.index * 2 + 1];
          if (begin !== undefined && end !== undefined) {
            const length = end - begin;
            budget.step(length);
            const expected = text.slice(begin, end);
            const actual = text.slice(position, position + length);
            if (instruction.ignoreCase ? instruction.fold ? instruction.fold(expected) === instruction.fold(actual) : expected.toLowerCase() === actual.toLowerCase() : expected === actual) push(state.pc + 1, position + length);
          }
        } else throw new ProgramError("unsupported jq regular expression instruction");
      }
    }
    return undefined;
  }

  canFindSync(): boolean {
    return this.code.length > 0 && this.dialect !== "jq" && this.dialect !== "rust" && Boolean(this.literalMatch || this.simpleRepeatMatch || this.chainMatch);
  }

  getFastPrefixInfo(): { readonly anchoredStart: boolean; readonly anchoredEnd: boolean; readonly prefix: string } | undefined {
    return this.fastPrefixInfo;
  }

  getLiteralMatchInfo(): { readonly value: string; readonly anchoredStart: boolean; readonly anchoredEnd: boolean } | undefined {
    return this.literalMatch;
  }

  findSyncFastInto(
    text: string,
    budget: Pick<PatternBudget, "step" | "maxBufferBytes" | "options">,
    from: number,
    outOffsets: Int32Array,
    textEnd = text.length,
    textStart = 0,
  ): boolean {
    this.assertInstructionLimit(budget);
    if (this.chainMatch) {
      const { prefix, anchoredStart, anchoredEnd, steps } = this.chainMatch;
      if (from > textEnd || (anchoredStart && from > textStart)) return false;
      const first = steps[0]!;
      const startStep = prefix.length > 0 && first.group === 0 ? 1 : 0;
      let found = -1;
      let matchEnd = -1;
      if (anchoredStart) {
        if (prefix.length === 0 || (textStart + prefix.length <= textEnd && text.startsWith(prefix, textStart))) {
          matchEnd = matchChainAt(steps, prefix.length, anchoredEnd, text, textStart, outOffsets, this.groupCount, textEnd, startStep);
          if (matchEnd >= 0) found = textStart;
        }
      } else if (prefix.length > 0) {
        let searchFrom = from;
        while (searchFrom <= textEnd - prefix.length) {
          const idx = text.indexOf(prefix, searchFrom);
          if (idx < 0 || idx > textEnd - prefix.length) break;
          const end = matchChainAt(steps, prefix.length, anchoredEnd, text, idx, outOffsets, this.groupCount, textEnd, startStep);
          if (end >= 0) {
            found = idx;
            matchEnd = end;
            break;
          }
          searchFrom = idx + 1;
        }
      } else {
        const head = first as Extract<ChainStep, { kind: "repeat" }>;
        const headAscii = head.ascii;
        const headAccepts = head.accepts;
        const headMin = head.minimum;
        let searchFrom = from;
        while (searchFrom < textEnd) {
          while (searchFrom < textEnd) {
            const c = text.codePointAt(searchFrom)!;
            if (c < 128 ? headAscii[c] !== 0 : headAccepts(String.fromCodePoint(c))) break;
            searchFrom += c > 0xffff ? 2 : 1;
          }
          if (searchFrom >= textEnd) break;
          let runEnd = searchFrom + (text.codePointAt(searchFrom)! > 0xffff ? 2 : 1);
          let count = 1;
          while (runEnd < textEnd) {
            const c = text.codePointAt(runEnd)!;
            if (c < 128 ? headAscii[c] === 0 : !headAccepts(String.fromCodePoint(c))) break;
            runEnd += c > 0xffff ? 2 : 1;
            count++;
          }
          if (count >= headMin) {
            const end = matchChainAt(steps, 0, anchoredEnd, text, searchFrom, outOffsets, this.groupCount, textEnd, 0);
            if (end >= 0) {
              found = searchFrom;
              matchEnd = end;
              break;
            }
          }
          searchFrom = runEnd + ((text.codePointAt(runEnd) ?? 0) > 0xffff ? 2 : 1);
        }
      }
      const positionsTried = anchoredStart ? 1 : found >= 0 ? found - from + 1 : textEnd - from + 1;
      const len = found >= 0 ? matchEnd - found : 0;
      budget.step(positionsTried * 2 + (found >= 0 ? this.code.length * 2 + len : 0));
      if (found < 0) return false;
      if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      return true;
    }
    if (this.simpleRepeatMatch) {
      const { prefix, anchoredStart, anchoredEnd, captured, minimum, accepts, ascii } = this.simpleRepeatMatch;
      if (from > textEnd || (anchoredStart && from > textStart)) return false;
      let found = -1;
      let matchEnd = -1;
      let groupStart = -1;
      let groupEnd = -1;
      let searchFrom = from;
      let runStart = -1;
      let runEnd = -1;
      let count = 0;
      while (searchFrom <= textEnd - prefix.length) {
        budget.step();
        const idx = anchoredStart
          ? textStart + prefix.length <= textEnd && text.startsWith(prefix, textStart) ? textStart : -1
          : text.indexOf(prefix, searchFrom);
        if (idx < 0 || idx > textEnd - prefix.length) break;
        budget.step(idx - searchFrom);
        const pos = idx + prefix.length;
        if (pos > runEnd) {
          runStart = pos;
          runEnd = pos;
          count = 0;
          while (runEnd < textEnd) {
            budget.step();
            const code = text.codePointAt(runEnd)!;
            if (code < 128 ? ascii[code] === 0 : !accepts(String.fromCodePoint(code))) break;
            runEnd += code > 0xffff ? 2 : 1;
            count++;
          }
        } else {
          // Overlapping prefixes reuse the accepted suffix. Count code points,
          // not UTF-16 units, as the candidate moves through the cached run.
          while (runStart < pos) {
            budget.step();
            runStart += text.codePointAt(runStart)! > 0xffff ? 2 : 1;
            count--;
          }
        }
        if (count >= minimum && (!anchoredEnd || runEnd === textEnd)) {
          found = idx;
          matchEnd = runEnd;
          groupStart = pos;
          groupEnd = runEnd;
          break;
        }
        if (anchoredStart) break;
        const next = prefix.length === 0 ? runEnd : idx;
        searchFrom = next + ((text.codePointAt(next) ?? 0) > 0xffff ? 2 : 1);
      }
      const positionsTried = anchoredStart ? 1 : found >= 0 ? found - from + 1 : textEnd - from + 1;
      const len = found >= 0 ? matchEnd - found : 0;
      budget.step(positionsTried * 2 + (found >= 0 ? this.code.length * 2 + len : 0));
      if (found < 0) return false;
      if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      outOffsets[0] = found;
      outOffsets[1] = matchEnd;
      outOffsets[2] = captured ? groupStart : -1;
      outOffsets[3] = captured ? groupEnd : -1;
      return true;
    }
    const { value, anchoredStart, anchoredEnd } = this.literalMatch!;
    const len = value.length;
    if (from > textEnd || (anchoredStart && from > textStart)) return false;
    let found = -1;
    if (anchoredStart && anchoredEnd) {
      if (from === textStart && textEnd - textStart === len && text.startsWith(value, textStart)) found = textStart;
    } else if (anchoredStart) {
      if (from === textStart && textStart + len <= textEnd && text.startsWith(value, textStart)) found = textStart;
    } else if (anchoredEnd) {
      const candidate = textEnd - len;
      if (candidate >= from && text.startsWith(value, candidate)) found = candidate;
    } else {
      const maxStart = textEnd - len;
      if (from <= maxStart) {
        if (textEnd === text.length || maxStart - from > 64) {
          const idx = text.indexOf(value, from);
          if (idx >= 0 && idx <= maxStart) found = idx;
        } else {
          const c0 = value.charCodeAt(0);
          const c1 = len > 1 ? value.charCodeAt(1) : -1;
          for (let i = from; i <= maxStart; i++) {
            if (
              text.charCodeAt(i) === c0 &&
              (len === 1 || (text.charCodeAt(i + 1) === c1 && (len === 2 || text.startsWith(value, i))))
            ) {
              found = i;
              break;
            }
          }
        }
      }
    }
    const positionsTried = anchoredStart ? 1 : found >= 0 ? found - from + 1 : textEnd - from + 1;
    budget.step(positionsTried * 2 + (found >= 0 ? this.code.length * 2 + len : 0));
    if (found < 0) return false;
    if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    outOffsets[0] = found;
    outOffsets[1] = found + len;
    outOffsets[2] = -1;
    outOffsets[3] = -1;
    return true;
  }

  private findAfterCheck(
    check: Promise<void>,
    text: string,
    budget: PatternBudget,
    from: number,
  ): Promise<Match | undefined> {
    return check.then(() => this.find(text, budget, from));
  }

  private finishLiteralAfterCheck(
    check: Promise<void>,
    found: number,
    len: number,
    maxBufferBytes: number,
    groups: readonly [string],
  ): Promise<Match | undefined> {
    if (found < 0) return check.then(RETURN_UNDEFINED);
    return check.then(() => {
      if (len > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      return { start: found, end: found + len, groups };
    });
  }

  tryFindSync(text: string, budget: PatternBudget, from = 0): Match | undefined | Promise<Match | undefined> {
    this.assertInstructionLimit(budget);
    if (this.code.length && this.chainMatch && this.dialect !== "jq" && this.dialect !== "rust") {
      const initialCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (initialCheck) return this.findAfterCheck(initialCheck, text, budget, from);
      if (!this.findSyncFastInto(text, budget, from, FAST_MATCH_OFFSETS)) return undefined;
      const start = FAST_MATCH_OFFSETS[0]!;
      const end = FAST_MATCH_OFFSETS[1]!;
      const groups: (string | undefined)[] = new Array(this.groupCount + 1);
      groups[0] = text.slice(start, end);
      for (let g = 1; g <= this.groupCount; g++) {
        const gs = FAST_MATCH_OFFSETS[g * 2]!;
        const ge = FAST_MATCH_OFFSETS[g * 2 + 1]!;
        groups[g] = gs >= 0 ? text.slice(gs, ge) : undefined;
      }
      return { start, end, groups };
    }
    if (this.code.length && this.simpleRepeatMatch && this.dialect !== "jq" && this.dialect !== "rust") {
      const initialCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (initialCheck) return this.findAfterCheck(initialCheck, text, budget, from);
      return this.execSimpleRepeat(text, budget, from);
    }
    if (!this.code.length || !this.literalMatch || this.dialect === "jq" || this.dialect === "rust") {
      return this.find(text, budget, from);
    }
    const initialCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (initialCheck) return this.findAfterCheck(initialCheck, text, budget, from);
    const { value, anchoredStart, anchoredEnd, groups } = this.literalMatch;
    const len = value.length;
    if (from > text.length || (anchoredStart && from > 0)) return undefined;
    let found = -1;
    if (anchoredStart && anchoredEnd) {
      if (from === 0 && text.length === len && text === value) found = 0;
    } else if (anchoredStart) {
      if (from === 0 && text.startsWith(value)) found = 0;
    } else if (anchoredEnd) {
      const candidate = text.length - len;
      if (candidate >= from && text.endsWith(value)) found = candidate;
    } else {
      found = text.indexOf(value, from);
    }
    const positionsTried = anchoredStart ? 1 : found >= 0 ? found - from + 1 : text.length - from + 1;
    const stepCount = positionsTried * 2 + (found >= 0 ? this.code.length * 2 + len : 0);
    budget.step(stepCount);
    if (stepCount >= 64) {
      const midCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (midCheck) return this.finishLiteralAfterCheck(midCheck, found, len, budget.maxBufferBytes, groups);
    }
    if (found < 0) return undefined;
    if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    return { start: found, end: found + len, groups };
  }

  tryTestSync(
    text: string,
    budget: PatternBudget,
    textStart = 0,
    textEnd = text.length,
  ): boolean | Promise<boolean> {
    if (this.canFindSync()) {
      const initialCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (!initialCheck) {
        return this.findSyncFastInto(text, budget, textStart, FAST_MATCH_OFFSETS, textEnd, textStart);
      }
      return initialCheck.then(() => this.findSyncFastInto(text, budget, textStart, FAST_MATCH_OFFSETS, textEnd, textStart));
    }
    const sub = textStart === 0 && textEnd === text.length ? text : text.slice(textStart, textEnd);
    const found = this.tryFindSync(sub, budget, 0);
    if (found instanceof Promise) return found.then(res => res !== undefined);
    return found !== undefined;
  }

  private execSimpleRepeat(
    text: string,
    budget: PatternBudget,
    from: number,
  ): Match | undefined | Promise<Match | undefined> {
    const matched = this.findSyncFastInto(text, budget, from, FAST_MATCH_OFFSETS);
    // Copy shared offsets before a checkpoint can yield to another matcher.
    const found = matched ? FAST_MATCH_OFFSETS[0]! : -1;
    const matchEnd = matched ? FAST_MATCH_OFFSETS[1]! : -1;
    const groupStart = matched ? FAST_MATCH_OFFSETS[2]! : -1;
    const groupEnd = matched ? FAST_MATCH_OFFSETS[3]! : -1;
    const { anchoredStart, captured } = this.simpleRepeatMatch!;
    const positionsTried = anchoredStart ? 1 : found >= 0 ? found - from + 1 : text.length - from + 1;
    const len = found >= 0 ? matchEnd - found : 0;
    const stepCount = positionsTried * 2 + (found >= 0 ? this.code.length * 2 + len : 0);
    if (stepCount >= 64) {
      const midCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (midCheck) {
        return midCheck.then(() => {
          if (found < 0) return undefined;
          if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
          const full = text.slice(found, matchEnd);
          const groups = captured ? [full, text.slice(groupStart, groupEnd)] : [full];
          return { start: found, end: matchEnd, groups };
        });
      }
    }
    if (found < 0) return undefined;
    if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    const full = text.slice(found, matchEnd);
    const groups = captured ? [full, text.slice(groupStart, groupEnd)] : [full];
    return { start: found, end: matchEnd, groups };
  }

  async find(text: string, budget: PatternBudget, from = 0, continuation = from): Promise<Match | undefined> {
    this.assertInstructionLimit(budget);
    if (!this.code.length) await this.prepare(budget);
    if (this.dialect === "jq" || this.dialect === "rust") return (await this.findJq(text, budget, from, { pc: 0, continuation }))?.match;
    if (this.simpleRepeatMatch) {
      const initialCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (initialCheck) await initialCheck;
      return await this.execSimpleRepeat(text, budget, from);
    }
    const initialCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (initialCheck) await initialCheck;
    if (this.literalMatch) {
      const { value, anchoredStart, anchoredEnd, groups } = this.literalMatch;
      const len = value.length;
      if (from > text.length || (anchoredStart && from > 0)) return undefined;
      let found = -1;
      if (anchoredStart && anchoredEnd) {
        if (from === 0 && text.length === len && text === value) found = 0;
      } else if (anchoredStart) {
        if (from === 0 && text.startsWith(value)) found = 0;
      } else if (anchoredEnd) {
        const candidate = text.length - len;
        if (candidate >= from && text.endsWith(value)) found = candidate;
      } else {
        found = text.indexOf(value, from);
      }
      const positionsTried = anchoredStart ? 1 : found >= 0 ? found - from + 1 : text.length - from + 1;
      const stepCount = positionsTried * 2 + (found >= 0 ? this.code.length * 2 + len : 0);
      budget.step(stepCount);
      if (stepCount >= 64) {
        const midCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
        if (midCheck) await midCheck;
      }
      if (found < 0) return undefined;
      if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      const endCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (endCheck) await endCheck;
      return { start: found, end: found + len, groups };
    }
    let units = 0;
    const work = (count = 1): void | Promise<void> => {
      budget.step(count);
      units += count;
      if (units < 64) return undefined;
      units %= 64;
      return (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    };
    if (this.linear) {
      for (let start = from; start <= text.length && (!this.anchored || start === 0); start += (text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1) {
        let position = start;
        for (const instruction of this.code) {
          const paused = work(2);
          if (paused) await paused;
          if (instruction.kind === "character") {
            if (position >= text.length) break;
            const character = String.fromCodePoint(text.codePointAt(position)!);
            if (!instruction.accepts(character)) break;
            position += character.length;
          } else if (instruction.kind === "begin" && position !== 0 || instruction.kind === "end" && position !== text.length) break;
          else if (instruction.kind === "match") {
            if (position - start > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
            const copied = work(position - start);
            if (copied) await copied;
            const match = { start, end: position, groups: [text.slice(start, position)] };
            await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
            return match;
          }
        }
      }
      return undefined;
    }
    interface Thread { pc: number; start: number; captures: number[]; bytes: number }
    const storage = new NfaStorage(budget);
    const positionDigits = String(text.length).length;
    const instructionDigits = String(this.code.length).length;
    if (from > text.length || this.anchored && from !== 0) return undefined;
    storage.reserve(128);
    const positions = new Map<number, Thread[]>();
    let earliestStarts: Map<number, number> | undefined;
    let nextStart = from;
    let bestStart: number | undefined;
    let bestEnd: number | undefined;
    let bestCaptures: number[] = [];
    let bestBytes = 0;
    try {
      if (this.groupCount && !this.backreferences && !this.anchored) {
        storage.reserve(64);
        earliestStarts = new Map();
      }
      let position = from;
      while (position <= text.length) {
        const advanced = work();
        if (advanced) await advanced;
        let pending = positions.get(position);
        if (bestStart === undefined && (!this.anchored || position === 0) && (!this.backreferences || position === nextStart)) {
          storage.reserve(72 + (pending ? 0 : 64));
          pending ??= [];
          pending.push({ pc: 0, start: position, captures: [], bytes: 72 });
        }
        if (!pending && !positions.size) break;
        if (!pending) { position += (text.codePointAt(position) ?? 0) > 0xffff ? 2 : 1; continue; }
        const reversed = work(pending.length);
        if (reversed) await reversed;
        pending.reverse();
        positions.delete(position);
        const visited = new Map<string | number, number>();
        let stateBytes = 0;
        const enqueue = (destination: number, pc: number, start: number, captures: number[], saveSlot?: number, clearUntil?: number): void => {
          const length = saveSlot === undefined ? captures.length : Math.max(captures.length, saveSlot + 1);
          const bytes = 72 + length * 8;
          const waiting = destination === position ? pending : positions.get(destination);
          storage.reserve(bytes + (waiting ? 0 : 64));
          const saved = saveSlot === undefined ? captures : [...captures];
          if (saveSlot !== undefined) {
            for (let slot = saveSlot + 2; slot < Math.min(clearUntil ?? 0, saved.length); slot++) delete saved[slot];
            saved[saveSlot] = position;
          }
          const thread = { pc, start, captures: saved, bytes };
          if (waiting) waiting.push(thread);
          else positions.set(destination, [thread]);
        };
        while (pending.length) {
          const paused = work();
          if (paused) await paused;
          const thread = pending.pop()!;
          try {
            if (bestStart !== undefined && thread.start > bestStart) continue;
            if (earliestStarts) {
              // Without backreferences captures affect only the result, so all
              // capture variants of a later start lose to the earliest start.
              const earliest = earliestStarts.get(thread.pc);
              if (earliest !== undefined && earliest < thread.start) continue;
              if (earliest === undefined) { storage.reserve(40); stateBytes += 40; }
              earliestStarts.set(thread.pc, thread.start);
            }
            let state: string | number = thread.pc;
            let bytes = 40;
            if (this.groupCount) {
              const joinedLength = Math.max(0, thread.captures.length - 1) + thread.captures.length * positionDigits;
              const stateLength = instructionDigits + 1 + joinedLength;
              const serialized = work(stateLength);
              if (serialized) await serialized;
              const reserved = 32 + joinedLength * 2 + 72 + stateLength * 2;
              storage.reserve(reserved);
              state = `${thread.pc}:${thread.captures.join(",")}`;
              bytes = 72 + state.length * 2;
              storage.release(reserved - bytes);
            } else storage.reserve(bytes);
            // At one input position, equal program/capture states have identical
            // futures. Keep the earliest start instead of rescanning each suffix.
            const priorStart = visited.get(state);
            if (priorStart !== undefined) {
              storage.release(bytes);
              if (priorStart <= thread.start) continue;
            } else stateBytes += bytes;
            visited.set(state, thread.start);
            const instruction = this.code[thread.pc]!;
            if (instruction.kind === "character") {
              if (position < text.length) {
                const character = String.fromCodePoint(text.codePointAt(position)!);
                if (instruction.accepts(character)) enqueue(position + character.length, thread.pc + 1, thread.start, thread.captures);
              }
            } else if (instruction.kind === "backreference") {
              const begin = thread.captures[instruction.index * 2];
              const end = thread.captures[instruction.index * 2 + 1];
              if (begin === undefined || end === undefined || position + end - begin > text.length) continue;
              let matches = true;
              for (let offset = 0; offset < end - begin; offset++) {
                const compared = work();
                if (compared) await compared;
                const expected = text[begin + offset]!;
                const actual = text[position + offset]!;
                if (instruction.ignoreCase ? expected.toLowerCase() !== actual.toLowerCase() : expected !== actual) { matches = false; break; }
              }
              if (matches) enqueue(position + end - begin, thread.pc + 1, thread.start, thread.captures);
            } else if (instruction.kind === "match") {
              let preferred = bestStart === undefined || thread.start < bestStart || thread.start === bestStart && position > bestEnd!;
              if (thread.start === bestStart && position === bestEnd) for (let index = 1; index <= this.groupCount; index++) {
                const compared = work();
                if (compared) await compared;
                const begin = thread.captures[index * 2];
                const end = thread.captures[index * 2 + 1];
                const priorBegin = bestCaptures[index * 2];
                const priorEnd = bestCaptures[index * 2 + 1];
                const length = begin === undefined || end === undefined ? -1 : end - begin;
                const priorLength = priorBegin === undefined || priorEnd === undefined ? -1 : priorEnd - priorBegin;
                if (length !== priorLength) { preferred = length > priorLength; break; }
              }
              if (preferred) {
                const retained = 32 + thread.captures.length * 8;
                storage.reserve(retained);
                bestStart = thread.start;
                bestEnd = position;
                bestCaptures = thread.captures;
                storage.release(bestBytes);
                bestBytes = retained;
              }
            } else if (instruction.kind === "split") {
              enqueue(position, instruction.second, thread.start, thread.captures);
              enqueue(position, instruction.first, thread.start, thread.captures);
            } else if (instruction.kind === "jump") enqueue(position, instruction.target, thread.start, thread.captures);
            else if (instruction.kind === "save") {
              const copied = work(Math.max(thread.captures.length, instruction.slot + 1));
              if (copied) await copied;
              enqueue(position, thread.pc + 1, thread.start, thread.captures, instruction.slot, instruction.clearUntil);
            } else if (instruction.kind === "boundary") {
              if (matchesBoundary(instruction, text, position)) enqueue(position, thread.pc + 1, thread.start, thread.captures);
            } else if (instruction.kind === "begin" ? position === 0 : position === text.length) enqueue(position, thread.pc + 1, thread.start, thread.captures);
          } finally { storage.release(thread.bytes); }
        }
        visited.clear();
        earliestStarts?.clear();
        storage.release(stateBytes + 64);
        if (this.backreferences && !positions.size) {
          // Captured text changes backreference transitions. Admit starts
          // serially to avoid retaining every start's distinct capture history.
          if (bestStart !== undefined || this.anchored) break;
          nextStart += (text.codePointAt(nextStart) ?? 0) > 0xffff ? 2 : 1;
          position = nextStart;
        } else position += (text.codePointAt(position) ?? 0) > 0xffff ? 2 : 1;
      }
      if (bestStart !== undefined && bestEnd !== undefined) {
        let characters = bestEnd - bestStart;
        for (let index = 1; index <= this.groupCount; index++) {
          const counted = work();
          if (counted) await counted;
          const begin = bestCaptures[index * 2];
          const end = bestCaptures[index * 2 + 1];
          if (begin !== undefined && end !== undefined) characters += end - begin;
        }
        const copied = work(characters);
        if (copied) await copied;
        storage.reserve(64 + (this.groupCount + 1) * 40 + characters * 2);
        const groups: (string | undefined)[] = [text.slice(bestStart, bestEnd)];
        for (let index = 1; index <= this.groupCount; index++) {
          const materialized = work();
          if (materialized) await materialized;
          const begin = bestCaptures[index * 2];
          const end = bestCaptures[index * 2 + 1];
          groups.push(begin === undefined || end === undefined ? undefined : text.slice(begin, end));
        }
        await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
        return { start: bestStart, end: bestEnd, groups };
      }
      return undefined;
    } finally { positions.clear(); earliestStarts?.clear(); storage.clear(); }
  }
}

type ReplacementSyntax = "sed" | "awk";

function hasCaseConversion(replacement: string): boolean {
  return replacement.includes("\\U") || replacement.includes("\\L") || replacement.includes("\\u") || replacement.includes("\\l") || replacement.includes("\\E");
}

// Stream individual code points so conversion never allocates an unbounded
// expanded capture, and empty captures preserve a pending one-character mode.
function* caseReplacement(replacement: string, match: Match, encoding?: "utf8" | "byte"): Generator<string> {
  const characterAt = (text: string, index: number): string => {
    if (encoding !== "utf8" || text.charCodeAt(index) < 128) return String.fromCodePoint(text.codePointAt(index)!);
    const decoded = decodeByteText(text.slice(index, index + 4)).text;
    return encodeByteText(String.fromCodePoint(decoded.codePointAt(0)!));
  };
  let mode = "";
  let once = "";
  for (let index = 0; index < replacement.length;) {
    let piece = characterAt(replacement, index);
    index += piece.length;
    if (piece === "&") piece = match.groups[0] ?? "";
    else if (piece === "\\" && index < replacement.length) {
      const next = replacement[index++]!;
      if (next === "U" || next === "L" || next === "E") {
        mode = next === "E" ? "" : next;
        once = "";
        yield "";
        continue;
      }
      if (next === "u" || next === "l") {
        once = next.toUpperCase();
        yield "";
        continue;
      }
      piece = next >= "0" && next <= "9" ? match.groups[Number(next)] ?? "" : next === "n" ? "\n" : next === "t" ? "\t" : next;
    }
    if (!piece) yield "";
    for (let offset = 0; offset < piece.length;) {
      const raw = characterAt(piece, offset);
      offset += raw.length;
      const character = encoding === "utf8" ? decodeByteText(raw).text : raw;
      const conversion = once || mode;
      once = "";
      const converted = encoding === "byte" && character.charCodeAt(0) >= 128 ? character
        : conversion === "U" ? character.toUpperCase() : conversion === "L" ? character.toLowerCase() : character;
      yield encoding === "utf8" ? encodeByteText(converted) : converted;
    }
  }
}

async function replacementLength(replacement: string, match: Match, budget: Budget, available: number, syntax: ReplacementSyntax, encoding?: "utf8" | "byte"): Promise<number> {
  let length = 0;
  let tokens = 0;
  if (syntax === "sed" && hasCaseConversion(replacement)) {
    for (const piece of caseReplacement(replacement, match, encoding)) {
      if (tokens++ % 256 === 0) await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      budget.step();
      if (piece.length > available - length) throw new ProgramError("text buffer limit exceeded");
      length += piece.length;
    }
    return length;
  }
  for (let index = 0; index < replacement.length; index++) {
    if (tokens++ % 256 === 0) await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    budget.step();
    const character = replacement[index]!;
    let size = 1;
    if (character === "&") {
      budget.step();
      size = match.groups[0]?.length ?? 0;
    } else if (character === "\\" && index + 1 < replacement.length) {
      budget.step();
      const next = replacement[++index]!;
      if (syntax === "awk") {
        size = next === "&" || next === "\\" ? 1 : 2;
      } else if (next >= "0" && next <= "9") {
        budget.step();
        size = match.groups[Number(next)]?.length ?? 0;
      }
    }
    if (size > available - length) throw new ProgramError("text buffer limit exceeded");
    length += size;
  }
  return length;
}

async function replacementText(replacement: string, match: Match, buffer: ReplacementBuffer, budget: Budget, syntax: ReplacementSyntax, encoding?: "utf8" | "byte"): Promise<void> {
  let literal = 0;
  let tokens = 0;
  if (syntax === "sed" && hasCaseConversion(replacement)) {
    let chunk = "";
    for (const piece of caseReplacement(replacement, match, encoding)) {
      if (tokens++ % 256 === 0) await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      budget.step();
      chunk += piece;
      if (chunk.length >= 1024) { await buffer.append(chunk); chunk = ""; }
    }
    await buffer.append(chunk);
    return;
  }
  for (let index = 0; index < replacement.length; index++) {
    if (tokens++ % 256 === 0) await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    budget.step();
    const character = replacement[index]!;
    if (character !== "&" && (character !== "\\" || index + 1 === replacement.length)) continue;
    await buffer.append(replacement, literal, index);
    if (character === "&") {
      budget.step();
      await buffer.append(match.groups[0] ?? "");
    } else {
      budget.step();
      const next = replacement[++index]!;
      if (syntax === "awk") {
        await buffer.append(replacement, next === "&" || next === "\\" ? index : index - 1, index + 1);
      } else if (next >= "0" && next <= "9") {
        budget.step();
        await buffer.append(match.groups[Number(next)] ?? "");
      } else await buffer.append(next === "n" ? "\n" : next === "t" ? "\t" : next);
    }
    literal = index + 1;
  }
  await buffer.append(replacement, literal);
}

const RETURN_UNDEFINED = (): undefined => undefined;
const RETURN_MINUS_ONE = (): -1 => -1;
const FAST_MATCH_OFFSETS = new Int32Array(20);
interface SimpleReplacement {
  readonly kind: "literal" | "singleRef" | "twoRefs";
  readonly prefix: string;
  readonly group: number;
  readonly mid: string;
  readonly group2: number;
  readonly suffix: string;
  readonly stepsPerExpansion: number;
  readonly smallInts: (string | undefined)[];
}
const SIMPLE_REPLACEMENT_CACHE = new Map<string, SimpleReplacement | null>();

function getSimpleReplacement(replacement: string, syntax: ReplacementSyntax): SimpleReplacement | null {
  const key = syntax === "sed" ? replacement : `awk:${replacement}`;
  const cached = SIMPLE_REPLACEMENT_CACHE.get(key);
  if (cached !== undefined) return cached;
  if (SIMPLE_REPLACEMENT_CACHE.size >= 128) SIMPLE_REPLACEMENT_CACHE.clear();
  if (!replacement.includes("&") && !replacement.includes("\\")) {
    const res: SimpleReplacement = { kind: "literal", prefix: replacement, group: -1, mid: "", group2: -1, suffix: "", stepsPerExpansion: replacement.length * 2 + 1, smallInts: [] };
    SIMPLE_REPLACEMENT_CACHE.set(key, res);
    return res;
  }
  if (syntax === "sed" && hasCaseConversion(replacement)) { SIMPLE_REPLACEMENT_CACHE.set(key, null); return null; }
  if (syntax === "sed") {
    let prefix = "";
    let mid = "";
    let suffix = "";
    let group = -1;
    let group2 = -1;
    let steps = 1;
    for (let i = 0; i < replacement.length; i++) {
      steps++;
      const ch = replacement[i]!;
      if (ch === "&") {
        if (group2 !== -1) { SIMPLE_REPLACEMENT_CACHE.set(key, null); return null; }
        steps++;
        if (group === -1) group = 0;
        else group2 = 0;
      } else if (ch === "\\" && i + 1 < replacement.length) {
        steps++;
        const next = replacement[++i]!;
        if (next >= "0" && next <= "9") {
          if (group2 !== -1) { SIMPLE_REPLACEMENT_CACHE.set(key, null); return null; }
          steps++;
          if (group === -1) group = next.charCodeAt(0) - 48;
          else group2 = next.charCodeAt(0) - 48;
        } else {
          const decoded = next === "n" ? "\n" : next === "t" ? "\t" : next;
          if (group === -1) prefix += decoded;
          else if (group2 === -1) mid += decoded;
          else suffix += decoded;
        }
      } else {
        if (group === -1) prefix += ch;
        else if (group2 === -1) mid += ch;
        else suffix += ch;
      }
    }
    const res: SimpleReplacement = group === -1
      ? { kind: "literal", prefix, group: -1, mid: "", group2: -1, suffix: "", stepsPerExpansion: steps + prefix.length, smallInts: [] }
      : group2 === -1
      ? { kind: "singleRef", prefix, group, mid: "", group2: -1, suffix: mid, stepsPerExpansion: steps + prefix.length + mid.length, smallInts: new Array(100) }
      : { kind: "twoRefs", prefix, group, mid, group2, suffix, stepsPerExpansion: steps + prefix.length + mid.length + suffix.length, smallInts: [] };
    SIMPLE_REPLACEMENT_CACHE.set(key, res);
    return res;
  }
  SIMPLE_REPLACEMENT_CACHE.set(key, null);
  return null;
}

function appendReplacementFromOffsetsSync(
  out: string,
  replacement: string,
  text: string,
  matchStart: number,
  matchEnd: number,
  group1Start: number,
  group1End: number,
  budget: Budget,
  maxBufferBytes: number,
  syntax: ReplacementSyntax,
  simpleRep = getSimpleReplacement(replacement, syntax),
  offsets = FAST_MATCH_OFFSETS,
): string {
  if (simpleRep !== null) {
    if (simpleRep.kind === "literal") {
      budget.step(simpleRep.stepsPerExpansion);
      if (out.length + simpleRep.prefix.length > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      return out ? out + simpleRep.prefix : simpleRep.prefix;
    }
    if (simpleRep.kind === "twoRefs") {
      const g1Start = simpleRep.group === 0 ? matchStart : simpleRep.group === 1 ? group1Start : offsets[simpleRep.group * 2]!;
      const g1End = simpleRep.group === 0 ? matchEnd : simpleRep.group === 1 ? group1End : offsets[simpleRep.group * 2 + 1]!;
      const g2Start = simpleRep.group2 === 0 ? matchStart : simpleRep.group2 === 1 ? group1Start : offsets[simpleRep.group2 * 2]!;
      const g2End = simpleRep.group2 === 0 ? matchEnd : simpleRep.group2 === 1 ? group1End : offsets[simpleRep.group2 * 2 + 1]!;
      const g1Len = g1Start >= 0 && g1End > g1Start ? g1End - g1Start : 0;
      const g2Len = g2Start >= 0 && g2End > g2Start ? g2End - g2Start : 0;
      const addedLen = simpleRep.prefix.length + g1Len + simpleRep.mid.length + g2Len + simpleRep.suffix.length;
      budget.step(simpleRep.stepsPerExpansion + g1Len + g2Len);
      if (out.length + addedLen > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      const g1Str = g1Len > 0 ? text.slice(g1Start, g1End) : "";
      const g2Str = g2Len > 0 ? text.slice(g2Start, g2End) : "";
      const expanded = simpleRep.suffix
        ? simpleRep.prefix + g1Str + simpleRep.mid + g2Str + simpleRep.suffix
        : simpleRep.prefix + g1Str + simpleRep.mid + g2Str;
      return out ? out + expanded : expanded;
    }
    const gStart = simpleRep.group === 0 ? matchStart : simpleRep.group === 1 ? group1Start : offsets[simpleRep.group * 2]!;
    const gEnd = simpleRep.group === 0 ? matchEnd : simpleRep.group === 1 ? group1End : offsets[simpleRep.group * 2 + 1]!;
    const gLen = gStart >= 0 && gEnd > gStart ? gEnd - gStart : 0;
    const addedLen = simpleRep.prefix.length + gLen + simpleRep.suffix.length;
    budget.step(simpleRep.stepsPerExpansion + gLen);
    if (out.length + addedLen > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    let expanded: string | undefined;
    if (gLen === 1) {
      const c0 = text.charCodeAt(gStart) - 48;
      if (c0 >= 0 && c0 <= 9) {
        expanded = simpleRep.smallInts[c0] ??= (simpleRep.suffix ? simpleRep.prefix + String.fromCharCode(c0 + 48) + simpleRep.suffix : simpleRep.prefix + String.fromCharCode(c0 + 48));
      }
    } else if (gLen === 2) {
      const c0 = text.charCodeAt(gStart) - 48;
      const c1 = text.charCodeAt(gStart + 1) - 48;
      if (c0 >= 1 && c0 <= 9 && c1 >= 0 && c1 <= 9) {
        const num = c0 * 10 + c1;
        expanded = simpleRep.smallInts[num] ??= (simpleRep.suffix ? simpleRep.prefix + String(num) + simpleRep.suffix : simpleRep.prefix + String(num));
      }
    }
    if (expanded === undefined) {
      const gStr = gLen > 0 ? text.slice(gStart, gEnd) : "";
      expanded = simpleRep.suffix ? simpleRep.prefix + gStr + simpleRep.suffix : simpleRep.prefix + gStr;
    }
    return out ? out + expanded : expanded;
  }
  const initialOutLen = out.length;
  let literalStart = 0;
  for (let index = 0; index < replacement.length; index++) {
    budget.step();
    const character = replacement[index]!;
    if (character !== "&" && (character !== "\\" || index + 1 >= replacement.length)) continue;
    if (index > literalStart) {
      const litLen = index - literalStart;
      if (out.length + litLen > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      const span = literalStart === 0 && index === replacement.length ? replacement : replacement.slice(literalStart, index);
      out = out ? out + span : span;
    }
    let piece = "";
    if (character === "&") {
      budget.step();
      piece = matchEnd > matchStart ? text.slice(matchStart, matchEnd) : "";
    } else {
      budget.step();
      const next = replacement[++index]!;
      if (syntax === "awk") {
        piece = next === "&" || next === "\\" ? next : `\\${next}`;
      } else if (next >= "0" && next <= "9") {
        budget.step();
        const g = next.charCodeAt(0) - 48;
        if (g === 0) piece = matchEnd > matchStart ? text.slice(matchStart, matchEnd) : "";
        else if (g === 1 && group1Start >= 0) piece = group1End > group1Start ? text.slice(group1Start, group1End) : "";
        else if (g > 1) {
          const gs = offsets[g * 2]!;
          const ge = offsets[g * 2 + 1]!;
          if (gs >= 0 && ge > gs) piece = text.slice(gs, ge);
        }
      } else {
        piece = next === "n" ? "\n" : next === "t" ? "\t" : next;
      }
    }
    if (out.length + piece.length > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    if (piece) out = out ? out + piece : piece;
    literalStart = index + 1;
  }
  if (literalStart < replacement.length) {
    const tailLen = replacement.length - literalStart;
    if (out.length + tailLen > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    const span = literalStart === 0 ? replacement : replacement.slice(literalStart);
    out = out ? out + span : span;
  }
  budget.step((out.length - initialOutLen) + 1);
  return out;
}

function substituteAfterCheck(
  check: Promise<void>,
  text: string,
  pattern: Pattern,
  replacement: string,
  budget: Budget,
  global: boolean,
  occurrence: number,
  syntax: ReplacementSyntax,
): Promise<{ text: string; count: number }> {
  return check.then(() => substitute(text, pattern, replacement, budget, global, occurrence, syntax));
}

function resolveSubAfterCheck(
  check: Promise<void>,
  out: string,
  count: number,
): Promise<{ text: string; count: number }> {
  return check.then(() => ({ text: out, count }));
}

export function trySubstituteSync(
  text: string,
  pattern: Pattern,
  replacement: string,
  budget: Budget,
  global: boolean,
  occurrence = 1,
  syntax: ReplacementSyntax = "sed",
): { text: string; count: number } | Promise<{ text: string; count: number }> {
  if (pattern.canFindSync() && text.length <= 4096 && replacement.length <= 256 && !(syntax === "sed" && hasCaseConversion(replacement))) {
    let search = 0;
    let consumed = 0;
    let previousEnd = -1;
    let encountered = 0;
    let count = 0;
    let out = "";
    while (search <= text.length) {
      budget.step();
      if (!pattern.findSyncFastInto(text, budget, search, FAST_MATCH_OFFSETS)) break;
      const matchStart = FAST_MATCH_OFFSETS[0]!;
      const matchEnd = FAST_MATCH_OFFSETS[1]!;
      const group1Start = FAST_MATCH_OFFSETS[2]!;
      const group1End = FAST_MATCH_OFFSETS[3]!;
      if (matchStart === matchEnd && matchStart === previousEnd) {
        search = matchEnd + 1;
        continue;
      }
      encountered++;
      if (encountered >= occurrence) {
        const prefixLen = matchStart - consumed;
        if (out.length + prefixLen > budget.maxBufferBytes) {
          throw new ProgramError("text buffer limit exceeded");
        }
        if (prefixLen > 0) {
          const pref = text.slice(consumed, matchStart);
          out = out ? out + pref : pref;
        }
        out = appendReplacementFromOffsetsSync(out, replacement, text, matchStart, matchEnd, group1Start, group1End, budget, budget.maxBufferBytes, syntax);
        consumed = matchEnd;
        count++;
        if (!global || pattern.getFastPrefixInfo()?.anchoredStart) break;
      }
      previousEnd = matchEnd;
      search = matchEnd === matchStart ? matchEnd + 1 : matchEnd;
    }
    if (count > 0) {
      const tailLen = text.length - consumed;
      if (out.length + tailLen > budget.maxBufferBytes) {
        throw new ProgramError("text buffer limit exceeded");
      }
      if (tailLen > 0) {
        const tail = consumed === 0 ? text : text.slice(consumed);
        out = out ? out + tail : tail;
      }
    } else {
      out = budget.check(text);
    }
    return { text: out, count };
  }
  if (!global && occurrence === 1 && !replacement.includes("&") && !replacement.includes("\\")) {
    budget.step();
    const matchOrPromise = pattern.tryFindSync(text, budget, 0);
    if (matchOrPromise instanceof Promise) {
      return matchOrPromise.then(match => {
        if (!match) {
          budget.step(0);
          return { text: budget.check(text), count: 0 };
        }
        const newLen = text.length - (match.end - match.start) + replacement.length;
        if (newLen > budget.maxBufferBytes || match.start + replacement.length > budget.maxBufferBytes) {
          throw new ProgramError("text buffer limit exceeded");
        }
        budget.step(replacement.length * 2 + 1);
        const out = (match.start === 0 ? "" : text.slice(0, match.start)) + replacement + (match.end === text.length ? "" : text.slice(match.end));
        return { text: budget.check(out), count: 1 };
      });
    }
    const match = matchOrPromise;
    if (!match) {
      budget.step(0);
      return { text: budget.check(text), count: 0 };
    }
    const newLen = text.length - (match.end - match.start) + replacement.length;
    if (newLen > budget.maxBufferBytes || match.start + replacement.length > budget.maxBufferBytes) {
      throw new ProgramError("text buffer limit exceeded");
    }
    budget.step(replacement.length * 2 + 1);
    const out = (match.start === 0 ? "" : text.slice(0, match.start)) + replacement + (match.end === text.length ? "" : text.slice(match.end));
    return { text: budget.check(out), count: 1 };
  }
  return substitute(text, pattern, replacement, budget, global, occurrence, syntax);
}

export async function substitute(text: string, pattern: Pattern, replacement: string, budget: Budget, global: boolean, occurrence = 1, syntax: ReplacementSyntax = "sed"): Promise<{ text: string; count: number }> {
  if (!global && occurrence === 1 && !replacement.includes("&") && !replacement.includes("\\")) {
    const check = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (check) await check;
    budget.step();
    const match = await pattern.find(text, budget, 0);
    if (!match) {
      budget.step(0);
      return { text: budget.check(text), count: 0 };
    }
    const newLen = text.length - (match.end - match.start) + replacement.length;
    if (newLen > budget.maxBufferBytes || match.start + replacement.length > budget.maxBufferBytes) {
      throw new ProgramError("text buffer limit exceeded");
    }
    budget.step(replacement.length * 2 + 1);
    const out = (match.start === 0 ? "" : text.slice(0, match.start)) + replacement + (match.end === text.length ? "" : text.slice(match.end));
    return { text: budget.check(out), count: 1 };
  }
  let search = 0;
  let consumed = 0;
  let previousEnd = -1;
  let encountered = 0;
  let count = 0;
  const encoding = pattern instanceof BytePattern ? pattern.usesUnicode(budget) ? "utf8" : "byte" : undefined;
  const result = new ReplacementBuffer(budget);
  try {
    while (search <= text.length) {
      await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      budget.step();
      const match = await pattern.find(text, budget, search);
      if (!match) break;
      if (match.start === match.end && match.start === previousEnd) { search = match.end + 1; continue; }
      encountered++;
      if (encountered >= occurrence) {
        const prefix = match.start - consumed;
        result.admit(prefix);
        const length = await replacementLength(replacement, match, budget, result.remaining - prefix, syntax, encoding);
        result.admit(prefix + length);
        await result.append(text, consumed, match.start);
        await replacementText(replacement, match, result, budget, syntax, encoding);
        consumed = match.end; count++;
        if (!global) break;
      }
      previousEnd = match.end > match.start ? match.end : -1;
      search = match.end > match.start ? match.end : match.end + 1;
    }
    budget.step(0);
    if (!count) return { text: budget.check(text), count };
    await result.append(text, consumed);
    return { text: await result.finish(), count };
  } finally { result.clear(); }
}


const PAIR_OFFSETS_1 = new Int32Array(20);
const PAIR_OFFSETS_2 = new Int32Array(20);

export function trySubstitutePairSync(
  text: string,
  pat1: Pattern,
  rep1: string,
  global1: boolean,
  occ1: number,
  pat2: Pattern,
  rep2: string,
  global2: boolean,
  occ2: number,
  budget: Budget,
): { text: string; substituted: boolean } | undefined | Promise<undefined> {
  if (occ1 !== 1 || occ2 !== 1 || text.length > 4096) return undefined;
  if (!pat1.canFindSync() || !pat2.canFindSync()) return undefined;
  const info1 = pat1.getFastPrefixInfo();
  const info2 = pat2.getFastPrefixInfo();
  if (!info1 || !info2 || !info1.anchoredStart || info2.anchoredStart || info2.prefix.length === 0) return undefined;
  const sr1 = getSimpleReplacement(rep1, "sed");
  const sr2 = getSimpleReplacement(rep2, "sed");
  if (!sr1 || !sr2) return undefined;
  budget.step();
  let effectiveE1 = 0;
  let exp1 = "";
  let effectiveExp1Len = 0;
  let matched1 = false;
  if (pat1.findSyncFastInto(text, budget, 0, PAIR_OFFSETS_1)) {
    const e1 = PAIR_OFFSETS_1[1]!;
    if (e1 === 0) return undefined;
    matched1 = true;
    exp1 = appendReplacementFromOffsetsSync("", rep1, text, 0, e1, PAIR_OFFSETS_1[2]!, PAIR_OFFSETS_1[3]!, budget, budget.maxBufferBytes, "sed", sr1, PAIR_OFFSETS_1);
    let commonSuffix = 0;
    const maxSuffix = Math.min(exp1.length, e1);
    while (commonSuffix < maxSuffix && exp1.charCodeAt(exp1.length - 1 - commonSuffix) === text.charCodeAt(e1 - 1 - commonSuffix)) {
      commonSuffix++;
    }
    effectiveExp1Len = exp1.length - commonSuffix;
    effectiveE1 = e1 - commonSuffix;
    const firstChar2 = info2.prefix.charCodeAt(0);
    for (let i = 0; i < effectiveExp1Len; i++) {
      if (exp1.charCodeAt(i) === firstChar2) return undefined;
    }
  }
  budget.step();
  if (!pat2.findSyncFastInto(text, budget, effectiveE1, PAIR_OFFSETS_2)) {
    if (!matched1) {
      return { text: budget.check(text), substituted: false };
    }
    const outLen = effectiveExp1Len + (text.length - effectiveE1);
    if (outLen > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    budget.step(text.length - effectiveE1 + 1);
    const expPrefix = effectiveExp1Len === exp1.length ? exp1 : exp1.slice(0, effectiveExp1Len);
    return { text: effectiveE1 < text.length ? expPrefix + text.slice(effectiveE1) : expPrefix, substituted: true };
  }
  const s2 = PAIR_OFFSETS_2[0]!;
  const e2 = PAIR_OFFSETS_2[1]!;
  if (s2 < effectiveE1 || e2 === s2) return undefined;
  const g2s = PAIR_OFFSETS_2[2]!;
  const g2e = PAIR_OFFSETS_2[3]!;
  if (global2 && e2 <= text.length) {
    budget.step();
    if (pat2.findSyncFastInto(text, budget, e2, PAIR_OFFSETS_1)) return undefined;
  }
  const exp2 = appendReplacementFromOffsetsSync("", rep2, text, s2, e2, g2s, g2e, budget, budget.maxBufferBytes, "sed", sr2, PAIR_OFFSETS_2);
  const midLen = s2 - effectiveE1;
  const tailLen = text.length - e2;
  const totalLen = effectiveExp1Len + midLen + exp2.length + tailLen;
  if (totalLen > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
  budget.step(midLen + tailLen + 2);
  const expPrefix = effectiveExp1Len === 0 ? "" : effectiveExp1Len === exp1.length ? exp1 : exp1.slice(0, effectiveExp1Len);
  const mid = midLen > 0 ? text.slice(effectiveE1, s2) : "";
  const tail = tailLen > 0 ? text.slice(e2) : "";
  return { text: expPrefix + mid + exp2 + tail, substituted: true };
}

export function trySubstitutePairToBufferSync(
  text: string,
  pat1: Pattern,
  rep1: string,
  global1: boolean,
  occ1: number,
  pat2: Pattern,
  rep2: string,
  global2: boolean,
  occ2: number,
  budget: Budget,
  outBuf: Uint8Array,
  outPos: number,
  sepCode: number,
  lineStart = 0,
  lineEnd = text.length,
): number | Promise<-1> {
  const lineLen = lineEnd - lineStart;
  if (occ1 !== 1 || occ2 !== 1 || lineLen > 4096) return -1;
  if (!pat1.canFindSync() || !pat2.canFindSync()) return -1;
  const info1 = pat1.getFastPrefixInfo();
  const info2 = pat2.getFastPrefixInfo();
  if (!info1 || !info2 || !info1.anchoredStart || info2.anchoredStart || info2.prefix.length === 0) return -1;
  const sr1 = getSimpleReplacement(rep1, "sed");
  const sr2 = getSimpleReplacement(rep2, "sed");
  if (!sr1 || !sr2) return -1;
  budget.step();
  let effectiveE1 = lineStart;
  let exp1 = "";
  let effectiveExp1Len = 0;
  if (pat1.findSyncFastInto(text, budget, lineStart, PAIR_OFFSETS_1, lineEnd, lineStart)) {
    const e1 = PAIR_OFFSETS_1[1]!;
    if (e1 === lineStart) return -1;
    exp1 = appendReplacementFromOffsetsSync("", rep1, text, lineStart, e1, PAIR_OFFSETS_1[2]!, PAIR_OFFSETS_1[3]!, budget, budget.maxBufferBytes, "sed", sr1, PAIR_OFFSETS_1);
    let commonSuffix = 0;
    const maxSuffix = Math.min(exp1.length, e1 - lineStart);
    while (commonSuffix < maxSuffix && exp1.charCodeAt(exp1.length - 1 - commonSuffix) === text.charCodeAt(e1 - 1 - commonSuffix)) {
      commonSuffix++;
    }
    effectiveExp1Len = exp1.length - commonSuffix;
    effectiveE1 = e1 - commonSuffix;
    const firstChar2 = info2.prefix.charCodeAt(0);
    for (let i = 0; i < effectiveExp1Len; i++) {
      if (exp1.charCodeAt(i) === firstChar2) return -1;
    }
  }
  budget.step();
  if (!pat2.findSyncFastInto(text, budget, effectiveE1, PAIR_OFFSETS_2, lineEnd, lineStart)) {
    const outLen = effectiveExp1Len + (lineEnd - effectiveE1);
    if (outLen > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    if (outPos + outLen + 1 > outBuf.length) return -1;
    budget.step(lineEnd - effectiveE1 + 1);
    let pos = outPos;
    for (let i = 0; i < effectiveExp1Len; i++) outBuf[pos++] = exp1.charCodeAt(i);
    for (let i = effectiveE1; i < lineEnd; i++) outBuf[pos++] = text.charCodeAt(i);
    outBuf[pos++] = sepCode;
    return pos;
  }
  const s2 = PAIR_OFFSETS_2[0]!;
  const e2 = PAIR_OFFSETS_2[1]!;
  if (s2 < effectiveE1 || e2 === s2) return -1;
  const g2s = PAIR_OFFSETS_2[2]!;
  const g2e = PAIR_OFFSETS_2[3]!;
  if (global2 && e2 <= lineEnd) {
    budget.step();
    if (pat2.findSyncFastInto(text, budget, e2, PAIR_OFFSETS_1, lineEnd, lineStart)) return -1;
  }
  const exp2 = appendReplacementFromOffsetsSync("", rep2, text, s2, e2, g2s, g2e, budget, budget.maxBufferBytes, "sed", sr2, PAIR_OFFSETS_2);
  const midLen = s2 - effectiveE1;
  const tailLen = lineEnd - e2;
  const totalLen = effectiveExp1Len + midLen + exp2.length + tailLen;
  if (totalLen > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
  if (outPos + totalLen + 1 > outBuf.length) return -1;
  budget.step(midLen + tailLen + 2);
  let pos = outPos;
  for (let i = 0; i < effectiveExp1Len; i++) outBuf[pos++] = exp1.charCodeAt(i);
  for (let i = effectiveE1; i < s2; i++) outBuf[pos++] = text.charCodeAt(i);
  for (let i = 0; i < exp2.length; i++) outBuf[pos++] = exp2.charCodeAt(i);
  for (let i = e2; i < lineEnd; i++) outBuf[pos++] = text.charCodeAt(i);
  outBuf[pos++] = sepCode;
  return pos;
}

export function trySubstitutePairBatchToBufferSync(
  batchText: string,
  batchEnds: Int32Array,
  endsLen: number,
  pat1: Pattern,
  rep1: string,
  global1: boolean,
  occ1: number,
  pat2: Pattern,
  rep2: string,
  global2: boolean,
  occ2: number,
  budget: Budget,
  outBuf: Uint8Array,
  sepCode: number,
  maxOutLen: number,
): number {
  if (occ1 !== 1 || occ2 !== 1) return -1;
  if (!pat1.canFindSync() || !pat2.canFindSync()) return -1;
  const info1 = pat1.getFastPrefixInfo();
  const info2 = pat2.getFastPrefixInfo();
  if (!info1 || !info2 || !info1.anchoredStart || info2.anchoredStart || info2.prefix.length === 0) return -1;
  const sr1 = getSimpleReplacement(rep1, "sed");
  const sr2 = getSimpleReplacement(rep2, "sed");
  if (!sr1 || !sr2) return -1;

  const lit1 = pat1.getLiteralMatchInfo();
  const lit2 = pat2.getLiteralMatchInfo();
  const maxBuf = budget.maxBufferBytes;

  if (
    lit1 &&
    lit1.anchoredStart &&
    !lit1.anchoredEnd &&
    sr1.kind === "literal" &&
    lit2 &&
    !lit2.anchoredStart &&
    !lit2.anchoredEnd &&
    sr2.kind === "literal"
  ) {
    const v1 = lit1.value;
    const v1Len = v1.length;
    const v2 = lit2.value;
    const v2Len = v2.length;
    if (v1Len === 0 || v2Len === 0) return -1;
    const r1Val = sr1.prefix;
    let commonSuffix = 0;
    const maxSuffix = Math.min(r1Val.length, v1Len);
    while (
      commonSuffix < maxSuffix &&
      r1Val.charCodeAt(r1Val.length - 1 - commonSuffix) === v1.charCodeAt(v1Len - 1 - commonSuffix)
    ) {
      commonSuffix++;
    }
    const effectiveExp1Len = r1Val.length - commonSuffix;
    const effectiveE1Offset = v1Len - commonSuffix;
    const v2c0 = v2.charCodeAt(0);
    for (let i = 0; i < effectiveExp1Len; i++) {
      if (r1Val.charCodeAt(i) === v2c0) return -1;
    }
    const r2Val = sr2.prefix;
    const r2Len = r2Val.length;
    const v1c0 = v1.charCodeAt(0);
    const v1c1 = v1Len > 1 ? v1.charCodeAt(1) : -1;
    const v2c1 = v2Len > 1 ? v2.charCodeAt(1) : -1;

    let outPos = 0;
    let lStart = 0;
    for (let idx = 0; idx < endsLen; idx++) {
      const lEnd = batchEnds[idx]!;
      const lineLen = lEnd - lStart;
      if (lineLen > 4096) return -1;
      let effectiveE1 = lStart;
      let exp1Len = 0;
      if (
        lineLen >= v1Len &&
        batchText.charCodeAt(lStart) === v1c0 &&
        (v1Len === 1 || (batchText.charCodeAt(lStart + 1) === v1c1 && (v1Len === 2 || batchText.startsWith(v1, lStart))))
      ) {
        effectiveE1 = lStart + effectiveE1Offset;
        exp1Len = effectiveExp1Len;
      }
      const maxS2 = lEnd - v2Len;
      let s2 = -1;
      for (let i = effectiveE1; i <= maxS2; i++) {
        if (
          batchText.charCodeAt(i) === v2c0 &&
          (v2Len === 1 || (batchText.charCodeAt(i + 1) === v2c1 && (v2Len === 2 || batchText.startsWith(v2, i))))
        ) {
          s2 = i;
          break;
        }
      }
      if (s2 < 0) {
        const restLen = lEnd - effectiveE1;
        const outLen = exp1Len + restLen;
        if (outLen > maxBuf) throw new ProgramError("text buffer limit exceeded");
        if (outPos + outLen + 1 >= maxOutLen) return -2;
        for (let i = 0; i < exp1Len; i++) outBuf[outPos++] = r1Val.charCodeAt(i);
        for (let i = effectiveE1; i < lEnd; i++) outBuf[outPos++] = batchText.charCodeAt(i);
        outBuf[outPos++] = sepCode;
        budget.step(lineLen * 2 + exp1Len * 2 + 8);
      } else {
        const e2 = s2 + v2Len;
        if (global2 && e2 <= maxS2) {
          for (let i = e2; i <= maxS2; i++) {
            if (
              batchText.charCodeAt(i) === v2c0 &&
              (v2Len === 1 || (batchText.charCodeAt(i + 1) === v2c1 && (v2Len === 2 || batchText.startsWith(v2, i))))
            ) {
              return -1;
            }
          }
        }
        const midLen = s2 - effectiveE1;
        const tailLen = lEnd - e2;
        const totalLen = exp1Len + midLen + r2Len + tailLen;
        if (totalLen > maxBuf) throw new ProgramError("text buffer limit exceeded");
        if (outPos + totalLen + 1 >= maxOutLen) return -2;
        for (let i = 0; i < exp1Len; i++) outBuf[outPos++] = r1Val.charCodeAt(i);
        for (let i = effectiveE1; i < s2; i++) outBuf[outPos++] = batchText.charCodeAt(i);
        for (let i = 0; i < r2Len; i++) outBuf[outPos++] = r2Val.charCodeAt(i);
        for (let i = e2; i < lEnd; i++) outBuf[outPos++] = batchText.charCodeAt(i);
        outBuf[outPos++] = sepCode;
        budget.step(lineLen * 2 + exp1Len * 2 + r2Len * 2 + 16);
      }
      if (((idx + 1) & 31) === 0) {
        const pending = budget.checkpointSync ? budget.checkpointSync() : undefined;
        if (pending) {
          pending.catch(() => {});
          return -1;
        }
      }
      lStart = lEnd + 1;
    }
    return outPos;
  }

  let outPos = 0;
  let lStart = 0;
  const firstChar2 = info2.prefix.charCodeAt(0);
  for (let idx = 0; idx < endsLen; idx++) {
    const lEnd = batchEnds[idx]!;
    if (lEnd - lStart > 4096) return -1;
    budget.step();
    let effectiveE1 = lStart;
    let exp1 = "";
    let effectiveExp1Len = 0;
    if (pat1.findSyncFastInto(batchText, budget, lStart, PAIR_OFFSETS_1, lEnd, lStart)) {
      const e1 = PAIR_OFFSETS_1[1]!;
      if (e1 === lStart) return -1;
      exp1 = appendReplacementFromOffsetsSync("", rep1, batchText, lStart, e1, PAIR_OFFSETS_1[2]!, PAIR_OFFSETS_1[3]!, budget, budget.maxBufferBytes, "sed", sr1, PAIR_OFFSETS_1);
      let commonSuffix = 0;
      const maxSuffix = Math.min(exp1.length, e1 - lStart);
      while (commonSuffix < maxSuffix && exp1.charCodeAt(exp1.length - 1 - commonSuffix) === batchText.charCodeAt(e1 - 1 - commonSuffix)) {
        commonSuffix++;
      }
      effectiveExp1Len = exp1.length - commonSuffix;
      effectiveE1 = e1 - commonSuffix;
      for (let i = 0; i < effectiveExp1Len; i++) {
        if (exp1.charCodeAt(i) === firstChar2) return -1;
      }
    }
    budget.step();
    if (!pat2.findSyncFastInto(batchText, budget, effectiveE1, PAIR_OFFSETS_2, lEnd, lStart)) {
      const outLen = effectiveExp1Len + (lEnd - effectiveE1);
      if (outLen > maxBuf) throw new ProgramError("text buffer limit exceeded");
      if (outPos + outLen + 1 >= maxOutLen) return -2;
      budget.step(lEnd - effectiveE1 + 4);
      for (let i = 0; i < effectiveExp1Len; i++) outBuf[outPos++] = exp1.charCodeAt(i);
      for (let i = effectiveE1; i < lEnd; i++) outBuf[outPos++] = batchText.charCodeAt(i);
      outBuf[outPos++] = sepCode;
    } else {
      const s2 = PAIR_OFFSETS_2[0]!;
      const e2 = PAIR_OFFSETS_2[1]!;
      if (s2 < effectiveE1 || e2 === s2) return -1;
      const g2s = PAIR_OFFSETS_2[2]!;
      const g2e = PAIR_OFFSETS_2[3]!;
      if (global2 && e2 <= lEnd) {
        budget.step();
        if (pat2.findSyncFastInto(batchText, budget, e2, PAIR_OFFSETS_1, lEnd, lStart)) return -1;
      }
      const exp2 = appendReplacementFromOffsetsSync("", rep2, batchText, s2, e2, g2s, g2e, budget, budget.maxBufferBytes, "sed", sr2, PAIR_OFFSETS_2);
      const midLen = s2 - effectiveE1;
      const tailLen = lEnd - e2;
      const totalLen = effectiveExp1Len + midLen + exp2.length + tailLen;
      if (totalLen > maxBuf) throw new ProgramError("text buffer limit exceeded");
      if (outPos + totalLen + 1 >= maxOutLen) return -2;
      budget.step(midLen + tailLen + 5);
      for (let i = 0; i < effectiveExp1Len; i++) outBuf[outPos++] = exp1.charCodeAt(i);
      for (let i = effectiveE1; i < s2; i++) outBuf[outPos++] = batchText.charCodeAt(i);
      for (let i = 0; i < exp2.length; i++) outBuf[outPos++] = exp2.charCodeAt(i);
      for (let i = e2; i < lEnd; i++) outBuf[outPos++] = batchText.charCodeAt(i);
      outBuf[outPos++] = sepCode;
    }
    if (((idx + 1) & 31) === 0) {
      const pending = budget.checkpointSync ? budget.checkpointSync() : undefined;
      if (pending) {
        pending.catch(() => {});
        return -1;
      }
    }
    lStart = lEnd + 1;
  }
  return outPos;
}

const decodedByteSubjects = new WeakMap<object, { source: string; value: DecodedByteText }>();

/** Regex boundary for commands whose records and capture offsets are byte strings. */
export class BytePattern extends Pattern {
  private readonly unicode: Pattern;

  constructor(...args: ConstructorParameters<typeof Pattern>) {
    super(...args);
    const [source, ...settings] = args;
    this.unicode = new Pattern(decodeByteText(source).text, ...settings);
  }

  usesUnicode(budget: object): boolean {
    const owner = budget as { regexByteMode?: boolean; context?: { env?: Readonly<Record<string, string | undefined>> } };
    if (owner.regexByteMode) return false;
    const env = owner.context?.env;
    const locale = env?.LC_ALL || env?.LC_CTYPE || env?.LANG;
    return locale !== "C" && locale !== "POSIX";
  }

  private input(text: string, budget: Pick<PatternBudget, "step" | "maxBufferBytes">): DecodedByteText {
    const key = (budget as { context?: object }).context ?? budget;
    const cached = decodedByteSubjects.get(key);
    if (cached?.source === text) {
      budget.step(0);
      if (cached.value.offsets && (text.length + 1) * 6 > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      return cached.value;
    }
    const value = decodeByteText(text, budget);
    decodedByteSubjects.set(key, { source: text, value });
    return value;
  }

  private byteMatch(match: Match | undefined, decoded: DecodedByteText, budget: Pick<PatternBudget, "step">): Match | undefined {
    if (!match || !decoded.offsets) return match;
    budget.step(match.groups.reduce((count, group) => count + (group?.length ?? 0), 0));
    return {
      start: decoded.offsets[match.start]!,
      end: decoded.offsets[match.end]!,
      groups: match.groups.map(group => group === undefined ? undefined : encodeByteText(group)),
      ...(match.captureOffsets ? { captureOffsets: match.captureOffsets.map(offset =>
        offset === undefined || offset < 0 ? offset : decoded.offsets![offset]) } : {}),
    };
  }

  override async prepare(budget: Parameters<Pattern["prepare"]>[0]): Promise<void> {
    if (this.usesUnicode(budget)) await this.unicode.prepare(budget);
    else await super.prepare(budget);
  }

  override canFindSync(): boolean {
    return super.canFindSync() && this.unicode.canFindSync();
  }

  override getFastPrefixInfo(): ReturnType<Pattern["getFastPrefixInfo"]> {
    // Byte-specialized substitution fusion cannot consume Unicode character runs.
    return undefined;
  }

  override findSyncFastInto(
    text: string, budget: Parameters<Pattern["findSyncFastInto"]>[1],
    from: number, outOffsets: Int32Array, textEnd = text.length, textStart = 0,
  ): boolean {
    if (!this.usesUnicode(budget)) return super.findSyncFastInto(text, budget, from, outOffsets, textEnd, textStart);
    const segment = textStart === 0 && textEnd === text.length ? text : text.slice(textStart, textEnd);
    const decoded = this.input(segment, budget);
    const found = this.unicode.findSyncFastInto(decoded.text, budget, byteTextPosition(decoded, from - textStart),
      outOffsets, decoded.text.length, 0);
    if (found) for (let i = 0; i < (this.groupCount + 1) * 2; i++)
      if (outOffsets[i]! >= 0) outOffsets[i] = (decoded.offsets?.[outOffsets[i]!] ?? outOffsets[i]!) + textStart;
    return found;
  }

  override tryFindSync(text: string, budget: PatternBudget, from = 0): Match | undefined | Promise<Match | undefined> {
    if (!this.usesUnicode(budget)) return super.tryFindSync(text, budget, from);
    const decoded = this.input(text, budget);
    const result = this.unicode.tryFindSync(decoded.text, budget, byteTextPosition(decoded, from));
    return result instanceof Promise ? result.then(match => this.byteMatch(match, decoded, budget))
      : this.byteMatch(result, decoded, budget);
  }

  override async find(text: string, budget: PatternBudget, from = 0, continuation = from): Promise<Match | undefined> {
    if (!this.usesUnicode(budget)) return super.find(text, budget, from, continuation);
    const decoded = this.input(text, budget);
    return this.byteMatch(await this.unicode.find(decoded.text, budget, byteTextPosition(decoded, from),
      byteTextPosition(decoded, continuation)), decoded, budget);
  }
}
