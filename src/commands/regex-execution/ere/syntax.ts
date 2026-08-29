import { EreSyntaxError, EreUnsupportedError } from "./errors.js";
import { EreLedger } from "./limits.js";
import type { EreFragment, EreNode, EreProgram } from "./types.js";

const programs = new WeakMap<EreProgram, { root: EreNode; ledger: EreLedger }>();
const special = "\\.^$[]()|*+?{}";
const classes = new Set(["alnum", "alpha", "blank", "cntrl", "digit", "graph", "lower", "print", "punct", "space", "upper", "xdigit"]);

function classMember(name: string, code: number): boolean {
  const upper = code >= 65 && code <= 90;
  const lower = code >= 97 && code <= 122;
  const digit = code >= 48 && code <= 57;
  switch (name) {
    case "alnum": return upper || lower || digit;
    case "alpha": return upper || lower;
    case "blank": return code === 9 || code === 32;
    case "cntrl": return code < 32 || code === 127;
    case "digit": return digit;
    case "graph": return code >= 33 && code <= 126;
    case "lower": return lower;
    case "print": return code >= 32 && code <= 126;
    case "punct": return code >= 33 && code <= 126 && !upper && !lower && !digit;
    case "space": return code === 32 || code >= 9 && code <= 13;
    case "upper": return upper;
    case "xdigit": return digit || code >= 65 && code <= 70 || code >= 97 && code <= 102;
    default: return false;
  }
}

export async function admitAscii(text: string, ledger: EreLedger, signal?: AbortSignal): Promise<void> {
  for (let offset = 0; offset < text.length; offset++) {
    ledger.charge("work", 1, signal);
    const code = text.charCodeAt(offset);
    if (code === 0 || code > 127) throw new EreUnsupportedError("only non-NUL ASCII in the C/POSIX profile", offset);
    await ledger.checkpoint(signal);
  }
}

async function flatten(input: string | readonly EreFragment[], ledger: EreLedger, signal?: AbortSignal): Promise<{ pattern: string; quoted: readonly boolean[] | null }> {
  if (typeof input === "string") {
    ledger.admitInput("patternBytes", input.length, signal);
    await admitAscii(input, ledger, signal);
    return { pattern: input, quoted: null };
  }
  let size = 0;
  for (const fragment of input) {
    if (typeof fragment.text !== "string" || typeof fragment.literal !== "boolean") throw new TypeError("invalid ERE fragment");
    ledger.charge("work", 1, signal);
    await ledger.checkpoint(signal);
    ledger.admitInput("patternBytes", fragment.text.length, signal);
    await admitAscii(fragment.text, ledger, signal);
    if (fragment.text.length > ledger.limits.patternBytes - size) ledger.admitInput("patternBytes", ledger.limits.patternBytes + 1, signal);
    size += fragment.text.length;
    ledger.admitInput("patternBytes", size, signal);
  }
  ledger.charge("allocationUnits", size * 2 + input.length + 2, signal);
  const output: string[] = [];
  const quoted: boolean[] = [];
  for (const fragment of input) {
    for (let offset = 0; offset < fragment.text.length; offset++) {
      ledger.charge("work", 1, signal);
      await ledger.checkpoint(signal);
      quoted.push(fragment.literal);
    }
    output.push(fragment.text);
    await ledger.checkpoint(signal);
  }
  return { pattern: output.join(""), quoted: Object.freeze(quoted) };
}

class Parser {
  offset = 0;
  groups = 0;
  nodes = 0;
  constructor(readonly pattern: string, readonly quoted: readonly boolean[] | null, readonly ledger: EreLedger, readonly signal: AbortSignal | undefined) {}

  at(character: string, offset = this.offset): boolean { return !this.quoted?.[offset] && this.pattern[offset] === character; }

  node(create: () => EreNode): EreNode {
    if (this.nodes >= 4096) throw new EreUnsupportedError("4096-node grammar ceiling", this.offset);
    this.ledger.charge("allocationUnits", 8, this.signal);
    this.nodes++;
    return Object.freeze(create());
  }

  async expression(depth: number): Promise<EreNode> {
    if (depth > 64) throw new EreUnsupportedError("64-level grammar ceiling", this.offset);
    this.ledger.charge("allocationUnits", 1, this.signal);
    const alternatives: EreNode[] = [];
    while (true) {
      const child = await this.sequence(depth);
      this.ledger.charge("allocationUnits", 1, this.signal);
      alternatives.push(child);
      if (!this.at("|")) break;
      this.offset++;
    }
    if (alternatives.length === 1) return alternatives[0]!;
    this.ledger.charge("work", alternatives.length * 2, this.signal);
    await this.ledger.checkpoint(this.signal);
    return this.node(() => ({ kind: "alternative", children: Object.freeze(alternatives), nullable: alternatives.some(value => value.nullable), captured: alternatives.some(value => value.captured) }));
  }

  async sequence(depth: number): Promise<EreNode> {
    this.ledger.charge("allocationUnits", 1, this.signal);
    const children: EreNode[] = [];
    while (this.offset < this.pattern.length && !this.at("|") && !this.at(")")) {
      this.ledger.charge("work", 1, this.signal);
      await this.ledger.checkpoint(this.signal);
      let child = await this.atom(depth);
      const operator = this.quoted?.[this.offset] ? undefined : this.pattern[this.offset];
      if (operator === "*" || operator === "+" || operator === "?" || operator === "{") {
        const begin = this.offset++;
        let min = operator === "+" ? 1 : 0;
        let max = operator === "?" ? 1 : Infinity;
        if (operator === "{") {
          min = await this.count();
          max = min;
          if (this.at(",")) {
            this.offset++;
            max = this.at("}") ? Infinity : await this.count();
          }
          if (!this.at("}") || max < min) throw new EreSyntaxError("invalid interval", begin);
          this.offset++;
        }
        if (child.kind === "start" || child.kind === "end") throw new EreUnsupportedError("repeated anchor", begin);
        if (child.nullable && child.captured && max > 1) throw new EreUnsupportedError("nullable captured repetition", begin);
        const repeated = child;
        child = this.node(() => ({ kind: "repeat", child: repeated, min, max, nullable: min === 0 || repeated.nullable, captured: repeated.captured }));
        const next = this.quoted?.[this.offset] ? undefined : this.pattern[this.offset];
        if (next === "*" || next === "+" || next === "?" || next === "{") throw new EreUnsupportedError("stacked repetition", this.offset);
      }
      this.ledger.charge("allocationUnits", 1, this.signal);
      children.push(child);
    }
    if (children.length === 0) return this.node(() => ({ kind: "empty", nullable: true, captured: false }));
    if (children.length === 1) return children[0]!;
    this.ledger.charge("work", children.length * 2, this.signal);
    await this.ledger.checkpoint(this.signal);
    return this.node(() => ({ kind: "sequence", children: Object.freeze(children), nullable: children.every(value => value.nullable), captured: children.some(value => value.captured) }));
  }

  async count(): Promise<number> {
    const begin = this.offset;
    let value = 0;
    while (!this.quoted?.[this.offset] && this.pattern[this.offset] !== undefined && this.pattern[this.offset]! >= "0" && this.pattern[this.offset]! <= "9") {
      this.ledger.charge("work", 1, this.signal);
      await this.ledger.checkpoint(this.signal);
      value = value * 10 + this.pattern.charCodeAt(this.offset++) - 48;
      if (value > 255) throw new EreUnsupportedError("interval counts exceed 255", begin);
    }
    if (begin === this.offset) throw new EreSyntaxError("missing interval count", begin);
    return value;
  }

  async atom(depth: number): Promise<EreNode> {
    const begin = this.offset;
    const character = this.pattern[this.offset++]!;
    if (this.quoted?.[begin]) return this.node(() => ({ kind: "literal", code: character.charCodeAt(0), nullable: false, captured: false }));
    if (character === "(") {
      if (this.at("?")) throw new EreUnsupportedError("extended group syntax", begin);
      if (this.groups >= 32) throw new EreUnsupportedError("32-group grammar ceiling", begin);
      const index = ++this.groups;
      const child = await this.expression(depth + 1);
      if (!this.at(")")) throw new EreSyntaxError("unclosed group", begin);
      this.offset++;
      return this.node(() => ({ kind: "group", index, child, nullable: child.nullable, captured: true }));
    }
    if (character === "[") return this.set(begin);
    if (character === "\\") {
      const escaped = this.pattern[this.offset++];
      if (escaped === undefined) throw new EreSyntaxError("trailing escape", begin);
      if (!special.includes(escaped)) throw new EreUnsupportedError("backreference or escape extension", begin);
      return this.node(() => ({ kind: "literal", code: escaped.charCodeAt(0), nullable: false, captured: false }));
    }
    if (character === "*" || character === "+" || character === "?" || character === "{") throw new EreSyntaxError("repetition without operand", begin);
    if (character === ".") return this.node(() => ({ kind: "dot", nullable: false, captured: false }));
    if (character === "^") return this.node(() => ({ kind: "start", nullable: true, captured: false }));
    if (character === "$") return this.node(() => ({ kind: "end", nullable: true, captured: false }));
    return this.node(() => ({ kind: "literal", code: character.charCodeAt(0), nullable: false, captured: false }));
  }

  async set(begin: number): Promise<EreNode> {
    this.ledger.charge("allocationUnits", 128, this.signal);
    const members: boolean[] = new Array<boolean>(128).fill(false);
    const negate = this.at("^");
    if (negate) this.offset++;
    let first = true;
    while (this.offset < this.pattern.length) {
      this.ledger.charge("work", 1, this.signal);
      await this.ledger.checkpoint(this.signal);
      if (this.at("]") && !first) {
        this.offset++;
        if (negate) for (let code = 1; code < 128; code++) {
          this.ledger.charge("work", 1, this.signal);
          await this.ledger.checkpoint(this.signal);
          members[code] = !members[code];
        }
        return this.node(() => ({ kind: "set", members: Object.freeze(members), nullable: false, captured: false }));
      }
      first = false;
      if (this.at("[") && (this.at(".", this.offset + 1) || this.at("=", this.offset + 1))) {
        throw new EreUnsupportedError("collating or equivalence element", this.offset);
      }
      if (this.at("[") && this.at(":", this.offset + 1)) {
        const classBegin = this.offset;
        this.offset += 2;
        let name = "";
        while (this.offset < this.pattern.length && !this.at(":")) {
          this.ledger.charge("work", 1, this.signal);
          await this.ledger.checkpoint(this.signal);
          if (name.length >= 6) throw new EreSyntaxError("unknown character class", classBegin);
          name += this.pattern[this.offset++];
        }
        if (!this.at(":") || !this.at("]", this.offset + 1) || !classes.has(name)) throw new EreSyntaxError("unknown character class", classBegin);
        this.offset += 2;
        for (let code = 1; code < 128; code++) {
          this.ledger.charge("work", 1, this.signal);
          await this.ledger.checkpoint(this.signal);
          if (classMember(name, code)) members[code] = true;
        }
        if (this.at("-") && !this.at("]", this.offset + 1)) throw new EreSyntaxError("class cannot be a range endpoint", this.offset);
      } else {
        const lower = this.pattern.charCodeAt(this.offset++);
        if (this.at("-") && !this.at("]", this.offset + 1) && this.pattern[this.offset + 1] !== undefined) {
          this.offset++;
          if (this.at("[")) throw new EreSyntaxError("nonliteral range endpoint", this.offset);
          const upper = this.pattern.charCodeAt(this.offset++);
          if (lower > upper) throw new EreSyntaxError("descending range", this.offset - 3);
          for (let code = lower; code <= upper; code++) {
            this.ledger.charge("work", 1, this.signal);
            await this.ledger.checkpoint(this.signal);
            members[code] = true;
          }
        } else members[lower] = true;
      }
    }
    throw new EreSyntaxError("unclosed bracket expression", begin);
  }
}

export async function compileEre(input: string | readonly EreFragment[], ledger: EreLedger, signal?: AbortSignal): Promise<EreProgram> {
  ledger.check(signal);
  const { pattern, quoted } = await flatten(input, ledger, signal);
  const parser = new Parser(pattern, quoted, ledger, signal);
  const root = await parser.expression(0);
  if (parser.offset !== pattern.length) throw new EreSyntaxError("unmatched closing group", parser.offset);
  ledger.charge("allocationUnits", 3, signal);
  const program = Object.freeze({ pattern, groups: parser.groups });
  programs.set(program, { root, ledger });
  return program;
}

export function resolveEreProgram(program: EreProgram, ledger: EreLedger): EreNode {
  const entry = programs.get(program);
  if (!entry || entry.ledger !== ledger) throw new TypeError("ERE program is not bound to this invocation ledger");
  return entry.root;
}
