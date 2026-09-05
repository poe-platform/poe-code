import { Budget, ProgramError } from "./shared.js";
import { ReplacementBuffer } from "./replacement-buffer.js";

type Node = { type: "empty" | "begin" | "end" }
  | { type: "backreference"; index: number }
  | { type: "character"; accepts: (character: string) => boolean }
  | { type: "sequence" | "alternate"; nodes: Node[] }
  | { type: "repeat"; node: Node; minimum: number; maximum: number }
  | { type: "group"; node: Node; index: number };

type Instruction = { kind: "character"; accepts: (character: string) => boolean }
  | { kind: "backreference"; index: number; ignoreCase: boolean }
  | { kind: "begin" | "end" | "match" }
  | { kind: "save"; slot: number }
  | { kind: "jump"; target: number }
  | { kind: "split"; first: number; second: number };

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

export class Pattern {
  readonly groupCount: number;
  private readonly code: Instruction[] = [];
  private readonly anchored: boolean;

  constructor(source: string, extended = true, ignoreCase = false) {
    if (source.length > 8192) throw new ProgramError("regular expression exceeds 8192 bytes");
    if (!extended) source = extendedSource(source);
    let offset = 0;
    let groups = 0;
    const closedGroups = new Set<number>();
    let depth = 0;
    const characterNode = (character: string): Node => ({ type: "character", accepts: candidate => ignoreCase ? candidate.toLowerCase() === character.toLowerCase() : candidate === character });
    const escaped = (): string => {
      const character = source[offset++];
      if (character === undefined) throw new ProgramError("trailing backslash in regular expression");
      if (/^[1-9]$/u.test(character)) throw new ProgramError("pattern backreferences are not supported");
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
    const atom = (): Node => {
      const token = source[offset++];
      if (token === "(") {
        if (++depth > 64) throw new ProgramError("regular expression nesting limit exceeded");
        const index = ++groups;
        const node = alternate();
        if (source[offset++] !== ")") throw new ProgramError("unmatched '(' in regular expression");
        closedGroups.add(index);
        depth--;
        return { type: "group", index, node };
      }
      if (token === "[") return bracket();
      if (token === "\\") {
        const reference = source[offset];
        if (reference !== undefined && /^[1-9]$/u.test(reference)) {
          const index = Number(reference);
          if (!closedGroups.has(index)) throw new ProgramError("pattern references an undefined or open capture group");
          offset++;
          return { type: "backreference", index };
        }
        return characterNode(escaped());
      }
      if (token === ".") return { type: "character", accepts: () => true };
      if (token === "^") return { type: "begin" };
      if (token === "$") return { type: "end" };
      if (token === undefined || "*+?{}".includes(token)) throw new ProgramError("quantifier without an expression");
      return characterNode(token);
    };
    const repeated = (): Node => {
      let node = atom();
      const quantifier = source[offset];
      if (quantifier === "*" || quantifier === "+" || quantifier === "?") {
        offset++;
        node = { type: "repeat", node, minimum: quantifier === "+" ? 1 : 0, maximum: quantifier === "?" ? 1 : Infinity };
      } else if (quantifier === "{") {
        const match = /^\{([0-9]+)(?:,([0-9]*))?\}/u.exec(source.slice(offset));
        if (!match) throw new ProgramError("invalid repetition interval");
        const minimum = Number(match[1]);
        const maximum = match[2] === undefined ? minimum : match[2] === "" ? Infinity : Number(match[2]);
        if (minimum > 1000 || maximum !== Infinity && maximum > 1000 || maximum < minimum) throw new ProgramError("invalid or excessive repetition interval");
        offset += match[0].length;
        node = { type: "repeat", node, minimum, maximum };
      }
      if (source[offset] !== undefined && "*+?{".includes(source[offset]!)) throw new ProgramError("nested quantifier is not supported");
      return node;
    };
    const sequence = (): Node => {
      const nodes: Node[] = [];
      while (offset < source.length && source[offset] !== ")" && source[offset] !== "|") nodes.push(repeated());
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
    const emit = (instruction: Instruction): number => {
      if (this.code.length >= 16384) throw new ProgramError("compiled regular expression is too large");
      return this.code.push(instruction) - 1;
    };
    const compile = (node: Node): void => {
      if (node.type === "empty") return;
      if (node.type === "character") { emit({ kind: "character", accepts: node.accepts }); return; }
      if (node.type === "backreference") { emit({ kind: "backreference", index: node.index, ignoreCase }); return; }
      if (node.type === "begin" || node.type === "end") { emit({ kind: node.type }); return; }
      if (node.type === "sequence") { for (const child of node.nodes) compile(child); return; }
      if (node.type === "group") { emit({ kind: "save", slot: node.index * 2 }); compile(node.node); emit({ kind: "save", slot: node.index * 2 + 1 }); return; }
      if (node.type === "alternate") {
        const jumps: number[] = [];
        for (let index = 0; index < node.nodes.length; index++) {
          if (index === node.nodes.length - 1) { compile(node.nodes[index]!); break; }
          const split = emit({ kind: "split", first: this.code.length + 1, second: 0 });
          compile(node.nodes[index]!);
          jumps.push(emit({ kind: "jump", target: 0 }));
          (this.code[split] as Extract<Instruction, { kind: "split" }>).second = this.code.length;
        }
        for (const jump of jumps) (this.code[jump] as Extract<Instruction, { kind: "jump" }>).target = this.code.length;
        return;
      }
      if (node.type !== "repeat") throw new ProgramError("invalid internal regular expression node");
      for (let count = 0; count < node.minimum; count++) compile(node.node);
      if (node.maximum === Infinity) {
        const split = emit({ kind: "split", first: this.code.length + 1, second: 0 });
        compile(node.node); emit({ kind: "jump", target: split });
        (this.code[split] as Extract<Instruction, { kind: "split" }>).second = this.code.length;
      } else for (let count = node.minimum; count < node.maximum; count++) {
        const split = emit({ kind: "split", first: this.code.length + 1, second: 0 });
        compile(node.node);
        (this.code[split] as Extract<Instruction, { kind: "split" }>).second = this.code.length;
      }
    };
    compile(root); emit({ kind: "match" });
  }

  find(text: string, budget: Budget, from = 0): Match | undefined {
    interface Thread { pc: number; captures: number[] }
    for (let start = from; start <= text.length && (!this.anchored || start === 0); start++) {
      const positions = new Map<number, Thread[]>([[start, [{ pc: 0, captures: [] }]]]);
      let best: Match | undefined;
      let bestCaptures: number[] = [];
      let queued = 1;
      const preferCaptures = (captures: number[]): boolean => {
        for (let index = 1; index <= this.groupCount; index++) {
          const begin = captures[index * 2];
          const end = captures[index * 2 + 1];
          const priorBegin = bestCaptures[index * 2];
          const priorEnd = bestCaptures[index * 2 + 1];
          const length = begin === undefined || end === undefined ? -1 : end - begin;
          const priorLength = priorBegin === undefined || priorEnd === undefined ? -1 : priorEnd - priorBegin;
          if (length !== priorLength) return length > priorLength;
        }
        return false;
      };
      for (let position = start; positions.size && position <= text.length; position++) {
        budget.step();
        const pending = positions.get(position)?.reverse() ?? [];
        positions.delete(position);
        queued -= pending.length;
        const visited = new Set<string | number>();
        let stateBytes = 0;
        const enqueue = (destination: number, thread: Thread): void => {
          if (destination === position) pending.push(thread);
          else {
            const waiting = positions.get(destination);
            if (waiting) waiting.push(thread);
            else positions.set(destination, [thread]);
            queued++;
          }
          if ((queued + pending.length) * (32 + this.groupCount * 16) > budget.maxBufferBytes) throw new ProgramError("regular expression state buffer limit exceeded");
        };
        while (pending.length) {
          budget.step();
          const thread = pending.pop()!;
          const state = this.groupCount ? `${thread.pc}:${thread.captures.join(",")}` : thread.pc;
          if (visited.has(state)) continue;
          visited.add(state);
          stateBytes += typeof state === "string" ? state.length * 2 + 32 : 16;
          if (stateBytes > budget.maxBufferBytes) throw new ProgramError("regular expression state buffer limit exceeded");
          const instruction = this.code[thread.pc]!;
          if (instruction.kind === "character") {
            if (position < text.length && instruction.accepts(text[position]!)) enqueue(position + 1, { pc: thread.pc + 1, captures: thread.captures });
          } else if (instruction.kind === "backreference") {
            const begin = thread.captures[instruction.index * 2];
            const end = thread.captures[instruction.index * 2 + 1];
            if (begin === undefined || end === undefined || position + end - begin > text.length) continue;
            let matches = true;
            for (let offset = 0; offset < end - begin; offset++) {
              budget.step();
              const expected = text[begin + offset]!;
              const actual = text[position + offset]!;
              if (instruction.ignoreCase ? expected.toLowerCase() !== actual.toLowerCase() : expected !== actual) { matches = false; break; }
            }
            if (matches) enqueue(position + end - begin, { pc: thread.pc + 1, captures: thread.captures });
          } else if (instruction.kind === "match") {
            if (!best || position > best.end || position === best.end && preferCaptures(thread.captures)) {
              const groups: (string | undefined)[] = [text.slice(start, position)];
              for (let index = 1; index <= this.groupCount; index++) {
                const begin = thread.captures[index * 2];
                const end = thread.captures[index * 2 + 1];
                groups.push(begin === undefined || end === undefined ? undefined : text.slice(begin, end));
              }
              best = { start, end: position, groups };
              bestCaptures = thread.captures;
            }
          } else if (instruction.kind === "split") {
            pending.push({ pc: instruction.second, captures: thread.captures }, { pc: instruction.first, captures: thread.captures });
          } else if (instruction.kind === "jump") pending.push({ pc: instruction.target, captures: thread.captures });
          else if (instruction.kind === "save") {
            const captures = [...thread.captures]; captures[instruction.slot] = position;
            pending.push({ pc: thread.pc + 1, captures });
          } else if (instruction.kind === "begin" ? position === 0 : position === text.length) pending.push({ pc: thread.pc + 1, captures: thread.captures });
        }
      }
      if (best) return best;
    }
    return undefined;
  }
}

async function replacementLength(replacement: string, match: Match, budget: Budget, available: number): Promise<number> {
  let length = 0;
  let tokens = 0;
  for (let index = 0; index < replacement.length; index++) {
    if (tokens++ % 256 === 0) await budget.checkpoint();
    budget.step();
    const character = replacement[index]!;
    let size = 1;
    if (character === "&") {
      budget.step();
      size = match.groups[0]?.length ?? 0;
    } else if (character === "\\" && index + 1 < replacement.length) {
      budget.step();
      const next = replacement[++index]!;
      if (next >= "1" && next <= "9") {
        budget.step();
        size = match.groups[Number(next)]?.length ?? 0;
      }
    }
    if (size > available - length) throw new ProgramError("text buffer limit exceeded");
    length += size;
  }
  return length;
}

async function replacementText(replacement: string, match: Match, buffer: ReplacementBuffer, budget: Budget): Promise<void> {
  let literal = 0;
  let tokens = 0;
  for (let index = 0; index < replacement.length; index++) {
    if (tokens++ % 256 === 0) await budget.checkpoint();
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
      if (next >= "1" && next <= "9") {
        budget.step();
        await buffer.append(match.groups[Number(next)] ?? "");
      } else await buffer.append(next === "n" ? "\n" : next === "t" ? "\t" : next);
    }
    literal = index + 1;
  }
  await buffer.append(replacement, literal);
}

export async function substitute(text: string, pattern: Pattern, replacement: string, budget: Budget, global: boolean, occurrence = 1): Promise<{ text: string; count: number }> {
  let search = 0;
  let consumed = 0;
  let previousEnd = -1;
  let encountered = 0;
  let count = 0;
  const result = new ReplacementBuffer(budget);
  try {
    while (search <= text.length) {
      await budget.checkpoint();
      budget.step();
      const match = pattern.find(text, budget, search);
      if (!match) break;
      if (match.start === match.end && match.start === previousEnd) { search = match.end + 1; continue; }
      encountered++;
      if (encountered >= occurrence) {
        const prefix = match.start - consumed;
        result.admit(prefix);
        const length = await replacementLength(replacement, match, budget, result.remaining - prefix);
        result.admit(prefix + length);
        await result.append(text, consumed, match.start);
        await replacementText(replacement, match, result, budget);
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
