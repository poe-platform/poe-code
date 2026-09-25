import { Budget, ProgramError } from "./shared.js";
import { ReplacementBuffer } from "./replacement-buffer.js";

type Node = { type: "empty" | "begin" | "end" }
  | { type: "backreference"; index: number }
  | { type: "assertion"; node: Node; positive: boolean; behind: boolean }
  | { type: "character"; literal?: string; accepts: (character: string) => boolean }
  | { type: "sequence" | "alternate"; nodes: Node[] }
  | { type: "repeat"; node: Node; minimum: number; maximum: number; lazy?: boolean }
  | { type: "group"; node: Node; index: number };

type Instruction = { kind: "character"; literal?: string; accepts: (character: string) => boolean }
  | { kind: "backreference"; index: number; ignoreCase: boolean }
  | { kind: "assertion"; first: number; next: number; positive: boolean; behind: boolean }
  | { kind: "begin" | "end" | "match" }
  | { kind: "save"; slot: number }
  | { kind: "jump"; target: number }
  | { kind: "split"; first: number; second: number };

// Host-owned bounds cover both the parsed tree and expanded instruction storage.
const maxPatternInstructions = 16384;

function instructionCounts(root: Node): Map<Node, number> {
  const counts = new Map<Node, number>();
  const count = (node: Node): number => {
    let size: number;
    if (node.type === "empty") size = 0;
    else if (node.type === "group" || node.type === "assertion") size = 2 + count(node.node);
    else if (node.type === "sequence" || node.type === "alternate") {
      size = node.type === "alternate" ? 2 * (node.nodes.length - 1) : 0;
      for (const child of node.nodes) size += count(child);
      // Remove empty sequence work once, before enclosing repetitions amplify it.
      if (node.type === "sequence") node.nodes = node.nodes.filter(child => counts.get(child)! > 0);
    } else if (node.type === "repeat") {
      const child = count(node.node);
      size = node.maximum === Infinity ? child * (node.minimum + 1) + 2
        : child * node.maximum + node.maximum - node.minimum;
    } else size = 1;
    // Saturation keeps nested products bounded without ever expanding a repeat.
    size = Math.min(size, maxPatternInstructions + 1);
    counts.set(node, size);
    return size;
  };
  count(root);
  return counts;
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
  for (let offset = 0; offset < source.length; offset++) {
    const character = source[offset]!;
    if (character === "\\" && offset + 1 < source.length) {
      const next = source[++offset]!;
      result += !bracket && "()|+?{}".includes(next) ? next : `\\${next}`;
    } else {
      if (character === "[") bracket = true;
      if (character === "]") bracket = false;
      result += !bracket && "()|+?{}".includes(character) ? `\\${character}` : character;
    }
  }
  return result;
}

export interface Match { readonly start: number; readonly end: number; readonly groups: readonly (string | undefined)[] }

class NfaStorage {
  private used = 0;
  constructor(private readonly budget: Pick<Budget, "step" | "checkpoint" | "maxBufferBytes"> & Partial<Pick<Budget, "checkpointSync">>) {}
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
  private backreferences = false;

  constructor(source: string, extended = true, private readonly ignoreCase = false, private readonly dialect: "sed" | "awk" | "jq" = "sed", private readonly modifiers = "") {
    const prefix = dialect === "jq" ? "jq " : "";
    if (source.length > 8192) throw new ProgramError(`${prefix}regular expression source limit exceeded`);
    if (!extended) source = extendedSource(source);
    let offset = 0;
    let groups = 0;
    let depth = 0;
    const closedGroups = new Set<number>();
    const characterNode = (character: string): Node => ({
      type: "character",
      ...(ignoreCase ? {} : { literal: character }),
      accepts: candidate => ignoreCase ? candidate.toLowerCase() === character.toLowerCase() : candidate === character,
    });
    const escaped = (): string => {
      const character = source[offset++];
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
        const start = source[offset++] === "\\" ? escaped() : source[offset - 1]!;
        if (source[offset] === "-" && source[offset + 1] !== "]" && source[offset + 1] !== undefined) {
          offset++;
          const end = source[offset++] === "\\" ? escaped() : source[offset - 1]!;
          if (start > end) throw new ProgramError("reversed character range");
          tests.push(character => character >= start && character <= end);
        } else tests.push(character => character === start);
      }
      if (source[offset++] !== "]") throw new ProgramError("unterminated bracket expression");
      return { type: "character", accepts: character => {
        const accepted = tests.some(test => test(character) || ignoreCase && (test(character.toLowerCase()) || test(character.toUpperCase())));
        return negate ? !accepted : accepted;
      } };
    };
    const atom = (atStart: boolean, afterBegin: boolean): Node => {
      const token = dialect === "jq" && offset < source.length ? String.fromCodePoint(source.codePointAt(offset)!) : source[offset];
      offset += token?.length ?? 1;
      if (token === "(") {
        if (++depth > 64) throw new ProgramError(`${prefix}regular expression depth limit exceeded`);
        let name: string | undefined;
        let capturing = true;
        let assertion: { positive: boolean; behind: boolean } | undefined;
        if (dialect === "jq" && source[offset] === "?") {
          offset++;
          if (source[offset] === ":") { offset++; capturing = false; }
          else if (source[offset] === "=" || source[offset] === "!") {
            assertion = { positive: source[offset++] === "=", behind: false }; capturing = false;
          } else if (source[offset] === "<" && "=!".includes(source[offset + 1] ?? "")) {
            offset++;
            assertion = { positive: source[offset++] === "=", behind: true }; capturing = false;
          }
          else if (source[offset] === "<" && !"=!".includes(source[offset + 1] ?? "")) {
            const end = source.indexOf(">", ++offset);
            if (end < 0) throw new ProgramError("invalid named capture");
            name = source.slice(offset, end); offset = end + 1;
          } else throw new ProgramError("unsupported jq regular expression group");
        }
        const index = capturing ? ++groups : 0;
        if (name !== undefined) this.groupNames.set(name, index);
        const node = alternate();
        if (source[offset++] !== ")") throw new ProgramError("unmatched '(' in regular expression");
        closedGroups.add(index);
        depth--;
        return assertion ? { type: "assertion", node, ...assertion } : capturing ? { type: "group", index, node } : node;
      }
      if (token === "[") return bracket();
      if (token === "\\") {
        const reference = source[offset];
        if ((dialect === "sed" || dialect === "jq") && reference !== undefined && /^[1-9]$/u.test(reference)) {
          const index = Number(reference);
          if (!closedGroups.has(index)) throw new ProgramError("pattern references an undefined or open capture group");
          offset++;
          return { type: "backreference", index };
        }
        if (dialect === "jq" && reference !== undefined && "dDsSwW".includes(reference)) {
          offset++;
          const alphabet = reference.toLowerCase();
          return { type: "character", accepts: character => {
            const accepted = alphabet === "d" ? character >= "0" && character <= "9"
              : alphabet === "s" ? " \t\n\r\f\v".includes(character)
              : character >= "a" && character <= "z" || character >= "A" && character <= "Z" || character >= "0" && character <= "9" || character === "_";
            return reference === alphabet ? accepted : !accepted;
          } };
        }
        return characterNode(escaped());
      }
      if (token === ".") return { type: "character", accepts: character => dialect !== "jq" || modifiers.includes("m") || character !== "\n" };
      if (token === "^") return extended || atStart ? { type: "begin" } : characterNode(token);
      if (token === "$") return extended || offset === source.length || source[offset] === ")" || source[offset] === "|" ? { type: "end" } : characterNode(token);
      if (token === "*" && !extended && (atStart || afterBegin)) return characterNode(token);
      if (token === undefined || "*+?{}".includes(token)) throw new ProgramError("quantifier without an expression");
      return characterNode(token);
    };
    const repeated = (atStart: boolean, afterBegin: boolean): Node => {
      let node = atom(atStart, afterBegin);
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
    const sequence = (): Node => {
      const nodes: Node[] = [];
      while (offset < source.length && source[offset] !== ")" && source[offset] !== "|") nodes.push(repeated(nodes.length === 0, nodes.length === 1 && nodes[0]!.type === "begin"));
      return nodes.length ? { type: "sequence", nodes } : { type: "empty" };
    };
    const alternate = (): Node => {
      const nodes = [sequence()];
      while (source[offset] === "|") { offset++; nodes.push(sequence()); }
      return nodes.length === 1 ? nodes[0]! : { type: "alternate", nodes };
    };
    const root = alternate();
    if (offset !== source.length) throw new ProgramError("unmatched ')' in regular expression");
    this.groupCount = groups;
    this.anchored = root.type === "sequence" && root.nodes[0]?.type === "begin";
    const counts = instructionCounts(root);
    if (counts.get(root)! + 1 > maxPatternInstructions) throw new ProgramError(`${prefix}regular expression program limit exceeded`);
    this.parsed = { root, counts };
  }

  async prepare(budget: Pick<Budget, "step" | "checkpoint"> & Partial<Pick<Budget, "checkpointSync">>): Promise<void> {
    if (!this.parsed) return;
    const { root, counts } = this.parsed;
    budget.step(counts.get(root)! + 1);
    await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    // Publish only a finished program. Cancelled or concurrent preparations own
    // separate arrays, so a failed caller cannot leave a partially patched NFA.
    const code: Instruction[] = [];
    const ignoreCase = this.ignoreCase;
    const emit = (instruction: Instruction): number => {
      return code.push(instruction) - 1;
    };
    const compile = function* (node: Node): Generator<void> {
      if (counts.get(node) === 0) return;
      yield;
      if (node.type === "character") { emit({ kind: "character", ...(node.literal !== undefined ? { literal: node.literal } : {}), accepts: node.accepts }); return; }
      if (node.type === "backreference") { emit({ kind: "backreference", index: node.index, ignoreCase }); return; }
      if (node.type === "assertion") {
        const index = emit({ kind: "assertion", first: code.length + 1, next: 0, positive: node.positive, behind: node.behind });
        yield* compile(node.node); emit({ kind: "match" });
        (code[index] as Extract<Instruction, { kind: "assertion" }>).next = code.length;
        return;
      }
      if (node.type === "begin" || node.type === "end") { emit({ kind: node.type }); return; }
      if (node.type === "sequence") { for (const child of node.nodes) yield* compile(child); return; }
      if (node.type === "group") { emit({ kind: "save", slot: node.index * 2 }); yield* compile(node.node); emit({ kind: "save", slot: node.index * 2 + 1 }); return; }
      if (node.type === "alternate") {
        const jumps: number[] = [];
        for (let index = 0; index < node.nodes.length; index++) {
          yield;
          if (index === node.nodes.length - 1) { yield* compile(node.nodes[index]!); break; }
          const split = emit({ kind: "split", first: code.length + 1, second: 0 });
          yield* compile(node.nodes[index]!);
          jumps.push(emit({ kind: "jump", target: 0 }));
          (code[split] as Extract<Instruction, { kind: "split" }>).second = code.length;
        }
        for (const jump of jumps) (code[jump] as Extract<Instruction, { kind: "jump" }>).target = code.length;
        return;
      }
      if (node.type !== "repeat") throw new ProgramError("invalid internal regular expression node");
      // A zero-width noncapturing body may have an enormous minimum but emits
      // no instructions. Skip that loop while retaining optional split/jump work.
      if (counts.get(node.node)! > 0) for (let count = 0; count < node.minimum; count++) yield* compile(node.node);
      if (node.maximum === Infinity) {
        const split = emit({ kind: "split", first: code.length + 1, second: 0 });
        yield* compile(node.node); emit({ kind: "jump", target: split });
        (code[split] as Extract<Instruction, { kind: "split" }>).second = code.length;
        if (node.lazy) { const instruction = code[split] as Extract<Instruction, { kind: "split" }>; [instruction.first, instruction.second] = [instruction.second, instruction.first]; }
      } else for (let count = node.minimum; count < node.maximum; count++) {
        yield;
        const split = emit({ kind: "split", first: code.length + 1, second: 0 });
        yield* compile(node.node);
        (code[split] as Extract<Instruction, { kind: "split" }>).second = code.length;
        if (node.lazy) { const instruction = code[split] as Extract<Instruction, { kind: "split" }>; [instruction.first, instruction.second] = [instruction.second, instruction.first]; }
      }
    };
    let work = 0;
    for (const ignored of compile(root)) {
      if (++work % 64 === 0) { await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint()); budget.step(0); }
    }
    emit({ kind: "match" });
    await (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    budget.step(0);
    this.linear = code.every(instruction => instruction.kind === "character" || instruction.kind === "begin" || instruction.kind === "end" || instruction.kind === "match");
    if (this.linear && !this.ignoreCase && this.dialect !== "jq") {
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
      }
    } else if (!this.ignoreCase && this.dialect !== "jq" && root.type === "sequence" && this.groupCount <= 1) {
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
          (anchoredStart || prefix.length > 0) &&
          repeatNode?.type === "repeat" &&
          repeatNode.minimum >= 1 &&
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
        }
      }
    }
    this.backreferences = code.some(instruction => instruction.kind === "backreference");
    this.code = code;
    this.parsed = undefined;
  }

  private async findJq(text: string, budget: Pick<Budget, "step" | "checkpoint" | "maxBufferBytes"> & Partial<Pick<Budget, "checkpointSync">>, from: number,
    options: { pc: number; exact?: boolean; end?: number; captures?: number[] } = { pc: 0 }): Promise<{ match: Match; captures: number[] } | undefined> {
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
          const groups: (string | undefined)[] = [text.slice(start, position)];
          for (let index = 1; index <= this.groupCount; index++) {
            budget.step();
            groups.push(captures[index * 2] === undefined ? undefined : text.slice(captures[index * 2], captures[index * 2 + 1]));
          }
          return { match: { start, end: position, groups }, captures };
        }
        if (instruction.kind === "assertion") {
          const result = await this.findJq(text, budget, instruction.behind ? 0 : position,
            instruction.behind ? { pc: instruction.first, end: position, captures }
              : { pc: instruction.first, exact: true, captures });
          if (Boolean(result) === instruction.positive) push(instruction.next, position, result?.captures ?? captures);
        }
        else if (instruction.kind === "jump") push(instruction.target);
        else if (instruction.kind === "split") { push(instruction.second); push(instruction.first); }
        else if (instruction.kind === "save") { const saved = [...captures]; saved[instruction.slot] = position; push(state.pc + 1, position, saved); }
        else if (instruction.kind === "begin") { if (position === 0) push(state.pc + 1); }
        else if (instruction.kind === "end") { if (position === text.length || position === text.length - 1 && text[position] === "\n") push(state.pc + 1); }
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
            if (instruction.ignoreCase ? expected.toLowerCase() === actual.toLowerCase() : expected === actual) push(state.pc + 1, position + length);
          }
        } else throw new ProgramError("unsupported jq regular expression instruction");
      }
    }
    return undefined;
  }

  canFindSync(): boolean {
    return this.code.length > 0 && this.dialect !== "jq" && Boolean(this.literalMatch || this.simpleRepeatMatch);
  }

  findSyncFastInto(
    text: string,
    budget: Pick<Budget, "step" | "maxBufferBytes">,
    from: number,
    outOffsets: Int32Array,
  ): boolean {
    if (this.simpleRepeatMatch) {
      const { prefix, anchoredStart, anchoredEnd, captured, minimum, accepts, ascii } = this.simpleRepeatMatch;
      if (from > text.length || (anchoredStart && from > 0)) return false;
      let found = -1;
      let matchEnd = -1;
      let groupStart = -1;
      let groupEnd = -1;
      if (anchoredStart) {
        if (text.startsWith(prefix)) {
          const pos = prefix.length;
          let cursor = pos;
          while (cursor < text.length) {
            const code = text.charCodeAt(cursor);
            if (code < 128 ? ascii[code] === 0 : !accepts(text[cursor]!)) break;
            cursor++;
          }
          if (cursor - pos >= minimum && (!anchoredEnd || cursor === text.length)) {
            found = 0;
            matchEnd = cursor;
            groupStart = pos;
            groupEnd = cursor;
          }
        }
      } else {
        let searchFrom = from;
        while (searchFrom <= text.length - prefix.length) {
          const idx = text.indexOf(prefix, searchFrom);
          if (idx < 0) break;
          const pos = idx + prefix.length;
          let cursor = pos;
          while (cursor < text.length) {
            const code = text.charCodeAt(cursor);
            if (code < 128 ? ascii[code] === 0 : !accepts(text[cursor]!)) break;
            cursor++;
          }
          if (cursor - pos >= minimum && (!anchoredEnd || cursor === text.length)) {
            found = idx;
            matchEnd = cursor;
            groupStart = pos;
            groupEnd = cursor;
            break;
          }
          searchFrom = idx + 1;
        }
      }
      const positionsTried = anchoredStart ? 1 : found >= 0 ? found - from + 1 : text.length - from + 1;
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
    if (from > text.length || (anchoredStart && from > 0)) return false;
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
    budget.step(positionsTried * 2 + (found >= 0 ? this.code.length * 2 + len : 0));
    if (found < 0) return false;
    if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    outOffsets[0] = found;
    outOffsets[1] = found + len;
    outOffsets[2] = -1;
    outOffsets[3] = -1;
    return true;
  }

  tryFindSync(text: string, budget: Pick<Budget, "step" | "checkpoint" | "maxBufferBytes"> & Partial<Pick<Budget, "checkpointSync">>, from = 0): Match | undefined | Promise<Match | undefined> {
    if (this.code.length && this.simpleRepeatMatch && this.dialect !== "jq") {
      const initialCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (initialCheck) return initialCheck.then(() => this.find(text, budget, from));
      return this.execSimpleRepeat(text, budget, from);
    }
    if (!this.code.length || !this.literalMatch || this.dialect === "jq") {
      return this.find(text, budget, from);
    }
    const initialCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (initialCheck) return initialCheck.then(() => this.find(text, budget, from));
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
      if (midCheck) {
        if (found < 0) return midCheck.then(() => undefined);
        if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
        return midCheck.then(() => ({ start: found, end: found + len, groups }));
      }
    }
    if (found < 0) return undefined;
    if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    const endCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (endCheck) return endCheck.then(() => ({ start: found, end: found + len, groups }));
    return { start: found, end: found + len, groups };
  }

  private execSimpleRepeat(
    text: string,
    budget: Pick<Budget, "step" | "checkpoint" | "maxBufferBytes"> & Partial<Pick<Budget, "checkpointSync">>,
    from: number,
  ): Match | undefined | Promise<Match | undefined> {
    const { prefix, anchoredStart, anchoredEnd, captured, minimum, accepts, ascii } = this.simpleRepeatMatch!;
    if (from > text.length || (anchoredStart && from > 0)) return undefined;
    let found = -1;
    let matchEnd = -1;
    let groupStart = -1;
    let groupEnd = -1;
    if (anchoredStart) {
      if (text.startsWith(prefix)) {
        const pos = prefix.length;
        let cursor = pos;
        while (cursor < text.length) {
          const code = text.charCodeAt(cursor);
          if (code < 128 ? ascii[code] === 0 : !accepts(text[cursor]!)) break;
          cursor++;
        }
        if (cursor - pos >= minimum && (!anchoredEnd || cursor === text.length)) {
          found = 0;
          matchEnd = cursor;
          groupStart = pos;
          groupEnd = cursor;
        }
      }
    } else {
      let searchFrom = from;
      while (searchFrom <= text.length - prefix.length) {
        const idx = text.indexOf(prefix, searchFrom);
        if (idx < 0) break;
        const pos = idx + prefix.length;
        let cursor = pos;
        while (cursor < text.length && accepts(text[cursor]!)) cursor++;
        if (cursor - pos >= minimum && (!anchoredEnd || cursor === text.length)) {
          found = idx;
          matchEnd = cursor;
          groupStart = pos;
          groupEnd = cursor;
          break;
        }
        searchFrom = idx + 1;
      }
    }
    const positionsTried = anchoredStart ? 1 : found >= 0 ? found - from + 1 : text.length - from + 1;
    const len = found >= 0 ? matchEnd - found : 0;
    const stepCount = positionsTried * 2 + (found >= 0 ? this.code.length * 2 + len : 0);
    budget.step(stepCount);
    const finish = (): Match | undefined => {
      if (found < 0) return undefined;
      if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      const full = text.slice(found, matchEnd);
      const groups = captured ? [full, text.slice(groupStart, groupEnd)] : [full];
      return { start: found, end: matchEnd, groups };
    };
    if (stepCount >= 64) {
      const midCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
      if (midCheck) return midCheck.then(finish);
    }
    const endCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (endCheck) return endCheck.then(finish);
    return finish();
  }

  async find(text: string, budget: Pick<Budget, "step" | "checkpoint" | "maxBufferBytes"> & Partial<Pick<Budget, "checkpointSync">>, from = 0): Promise<Match | undefined> {
    if (!this.code.length) await this.prepare(budget);
    if (this.dialect === "jq") return (await this.findJq(text, budget, from))?.match;
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
    const work = (count = 1): Promise<void> | undefined => {
      budget.step(count);
      units += count;
      if (units < 64) return undefined;
      units %= 64;
      return (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    };
    if (this.linear) {
      for (let start = from; start <= text.length && (!this.anchored || start === 0); start++) {
        let position = start;
        for (const instruction of this.code) {
          const paused = work(2);
          if (paused) await paused;
          if (instruction.kind === "character") {
            if (position >= text.length || !instruction.accepts(text[position]!)) break;
            position++;
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
        if (!pending) { position++; continue; }
        const reversed = work(pending.length);
        if (reversed) await reversed;
        pending.reverse();
        positions.delete(position);
        const visited = new Map<string | number, number>();
        let stateBytes = 0;
        const enqueue = (destination: number, pc: number, start: number, captures: number[], saveSlot?: number): void => {
          const length = saveSlot === undefined ? captures.length : Math.max(captures.length, saveSlot + 1);
          const bytes = 72 + length * 8;
          const waiting = destination === position ? pending : positions.get(destination);
          storage.reserve(bytes + (waiting ? 0 : 64));
          const saved = saveSlot === undefined ? captures : [...captures];
          if (saveSlot !== undefined) saved[saveSlot] = position;
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
              if (position < text.length && instruction.accepts(text[position]!)) enqueue(position + 1, thread.pc + 1, thread.start, thread.captures);
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
              enqueue(position, thread.pc + 1, thread.start, thread.captures, instruction.slot);
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
          position = ++nextStart;
        } else position++;
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

async function replacementLength(replacement: string, match: Match, budget: Budget, available: number, syntax: ReplacementSyntax): Promise<number> {
  let length = 0;
  let tokens = 0;
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

async function replacementText(replacement: string, match: Match, buffer: ReplacementBuffer, budget: Budget, syntax: ReplacementSyntax): Promise<void> {
  let literal = 0;
  let tokens = 0;
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

const FAST_MATCH_OFFSETS = new Int32Array(4);
const SYNC_SUB_RESULT = { text: "", count: 0 };
interface SimpleReplacement {
  readonly kind: "literal" | "singleRef";
  readonly prefix: string;
  readonly group: number;
  readonly suffix: string;
  readonly stepsPerExpansion: number;
}
const SIMPLE_REPLACEMENT_CACHE = new Map<string, SimpleReplacement | null>();

function getSimpleReplacement(replacement: string, syntax: ReplacementSyntax): SimpleReplacement | null {
  const key = syntax === "sed" ? replacement : `awk:${replacement}`;
  const cached = SIMPLE_REPLACEMENT_CACHE.get(key);
  if (cached !== undefined) return cached;
  if (SIMPLE_REPLACEMENT_CACHE.size >= 128) SIMPLE_REPLACEMENT_CACHE.clear();
  if (!replacement.includes("&") && !replacement.includes("\\")) {
    const res: SimpleReplacement = { kind: "literal", prefix: replacement, group: -1, suffix: "", stepsPerExpansion: replacement.length * 2 + 1 };
    SIMPLE_REPLACEMENT_CACHE.set(key, res);
    return res;
  }
  if (syntax === "sed") {
    let prefix = "";
    let suffix = "";
    let group = -1;
    let steps = 1;
    for (let i = 0; i < replacement.length; i++) {
      steps++;
      const ch = replacement[i]!;
      if (ch === "&") {
        if (group !== -1) { SIMPLE_REPLACEMENT_CACHE.set(key, null); return null; }
        steps++;
        group = 0;
      } else if (ch === "\\" && i + 1 < replacement.length) {
        steps++;
        const next = replacement[++i]!;
        if (next >= "0" && next <= "9") {
          if (group !== -1) { SIMPLE_REPLACEMENT_CACHE.set(key, null); return null; }
          steps++;
          group = next.charCodeAt(0) - 48;
        } else {
          const decoded = next === "n" ? "\n" : next === "t" ? "\t" : next;
          if (group === -1) prefix += decoded;
          else suffix += decoded;
        }
      } else {
        if (group === -1) prefix += ch;
        else suffix += ch;
      }
    }
    const res: SimpleReplacement = group === -1
      ? { kind: "literal", prefix, group: -1, suffix: "", stepsPerExpansion: steps + prefix.length }
      : { kind: "singleRef", prefix, group, suffix, stepsPerExpansion: steps + prefix.length + suffix.length };
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
): string {
  if (simpleRep !== null) {
    if (simpleRep.kind === "literal") {
      budget.step(simpleRep.stepsPerExpansion);
      if (out.length + simpleRep.prefix.length > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
      return out ? out + simpleRep.prefix : simpleRep.prefix;
    }
    const gStart = simpleRep.group === 0 ? matchStart : simpleRep.group === 1 ? group1Start : -1;
    const gEnd = simpleRep.group === 0 ? matchEnd : simpleRep.group === 1 ? group1End : -1;
    const gLen = gStart >= 0 && gEnd > gStart ? gEnd - gStart : 0;
    const addedLen = simpleRep.prefix.length + gLen + simpleRep.suffix.length;
    budget.step(simpleRep.stepsPerExpansion + gLen);
    if (out.length + addedLen > maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    const gStr = gLen > 0 ? text.slice(gStart, gEnd) : "";
    const expanded = simpleRep.suffix ? simpleRep.prefix + gStr + simpleRep.suffix : simpleRep.prefix + gStr;
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

export function trySubstituteSync(
  text: string,
  pattern: Pattern,
  replacement: string,
  budget: Budget,
  global: boolean,
  occurrence = 1,
  syntax: ReplacementSyntax = "sed",
): { text: string; count: number } | Promise<{ text: string; count: number }> {
  if (pattern.canFindSync() && text.length <= 4096 && replacement.length <= 256) {
    const check = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (check) return substitute(text, pattern, replacement, budget, global, occurrence, syntax);
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
        if (!global) break;
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
    const postCheck = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (postCheck) return postCheck.then(() => ({ text: out, count }));
    SYNC_SUB_RESULT.text = out;
    SYNC_SUB_RESULT.count = count;
    return SYNC_SUB_RESULT;
  }
  if (!global && occurrence === 1 && !replacement.includes("&") && !replacement.includes("\\")) {
    const check = (budget.checkpointSync ? budget.checkpointSync() : budget.checkpoint());
    if (check) return substitute(text, pattern, replacement, budget, global, occurrence, syntax);
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
        const length = await replacementLength(replacement, match, budget, result.remaining - prefix, syntax);
        result.admit(prefix + length);
        await result.append(text, consumed, match.start);
        await replacementText(replacement, match, result, budget, syntax);
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
