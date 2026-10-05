import { EreSyntaxError, EreUnsupportedError } from "./errors.js";
import { EreLedger } from "./limits.js";
import type { EreFragment, EreNode, EreProgram } from "./types.js";

const programs = /* @__PURE__ */ new WeakMap<EreProgram, { root: EreNode; ledger: EreLedger }>();
interface CachedEreCompilation {
  readonly ascii: boolean;
  readonly pattern: string;
  readonly groups: number;
  readonly root: EreNode;
  readonly patternBytes: number;
  readonly work: number;
  readonly states: number;
  readonly allocationUnits: number;
}
const ereCompilationCache = /* @__PURE__ */ new Map<string, CachedEreCompilation>();
const special = "\\.^$[]()|*+?{}";
const classes = /* @__PURE__ */ new Set(["alnum", "alpha", "blank", "cntrl", "digit", "graph", "lower", "print", "punct", "space", "upper", "xdigit"]);

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

export function admitAscii(text: string, ledger: EreLedger, signal?: AbortSignal): void | Promise<void> {
  if (ledger.charge === EreLedger.prototype.charge && ledger.workAllowanceUntilCheckpoint(signal) >= text.length + 4) {
    for (let offset = 0; offset < text.length; offset++) {
      ledger.chargeWork(1, signal);
      const code = text.charCodeAt(offset);
      if (code === 0 || code > 127) throw new EreUnsupportedError("only non-NUL ASCII in the C/POSIX profile", offset);
    }
    const c = ledger.checkpoint(signal);
    if (c) return c;
    return;
  }
  return (async () => {
    for (let offset = 0; offset < text.length; offset++) {
      ledger.charge("work", 1, signal);
      const code = text.charCodeAt(offset);
      if (code === 0 || code > 127) throw new EreUnsupportedError("only non-NUL ASCII in the C/POSIX profile", offset);
      { const c = ledger.checkpoint(signal); if (c) await c; }
    }
  })();
}

async function admitPattern(text: string, ledger: EreLedger, signal: AbortSignal | undefined, unicode: boolean): Promise<number> {
  if (!unicode) { await admitAscii(text, ledger, signal); return text.length; }
  let bytes = 0;
  for (let offset = 0; offset < text.length;) {
    const code = text.codePointAt(offset)!;
    if (code === 0 || code >= 0xd800 && code <= 0xdfff) throw new EreUnsupportedError("expected non-NUL Unicode scalars", offset);
    bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    ledger.admitInput("patternBytes", bytes, signal);
    ledger.chargeWork(1, signal);
    const pending = ledger.checkpoint(signal);
    if (pending) await pending;
    offset += code > 65535 ? 2 : 1;
  }
  return bytes;
}

async function flatten(input: string | readonly EreFragment[], ledger: EreLedger, signal: AbortSignal | undefined, unicode: boolean): Promise<{ pattern: string; quoted: readonly boolean[] | null }> {
  if (typeof input === "string") {
    ledger.admitInput("patternBytes", input.length, signal);
    await admitPattern(input, ledger, signal, unicode);
    return { pattern: input, quoted: null };
  }
  let size = 0;
  for (const fragment of input) {
    if (typeof fragment.text !== "string" || typeof fragment.literal !== "boolean") throw new TypeError("invalid ERE fragment");
    ledger.charge("work", 1, signal);
    { const c = ledger.checkpoint(signal); if (c) await c; }
    ledger.admitInput("patternBytes", fragment.text.length, signal);
    const bytes = await admitPattern(fragment.text, ledger, signal, unicode);
    if (bytes > ledger.limits.patternBytes - size) ledger.admitInput("patternBytes", ledger.limits.patternBytes + 1, signal);
    size += bytes;
    ledger.admitInput("patternBytes", size, signal);
  }
  ledger.charge("allocationUnits", size * 2 + input.length + 2, signal);
  const output: string[] = [];
  const quoted: boolean[] = [];
  for (const fragment of input) {
    for (let offset = 0; offset < fragment.text.length; offset++) {
      ledger.charge("work", 1, signal);
      { const c = ledger.checkpoint(signal); if (c) await c; }
      quoted.push(fragment.literal);
    }
    output.push(fragment.text);
    { const c = ledger.checkpoint(signal); if (c) await c; }
  }
  return { pattern: output.join(""), quoted: Object.freeze(quoted) };
}

class Parser {
  ascii = true;
  offset = 0;
  groups = 0;
  constructor(readonly pattern: string, readonly quoted: readonly boolean[] | null, readonly ledger: EreLedger, readonly signal: AbortSignal | undefined, readonly insensitive: boolean, readonly localeProfile: { ranges: boolean; classes: boolean }) {}

  at(character: string, offset = this.offset): boolean { return !this.quoted?.[offset] && this.pattern[offset] === character; }

  node(create: () => EreNode): EreNode {
    this.ledger.charge("allocationUnits", 8, this.signal);
    return Object.freeze(create());
  }

  async expression(): Promise<EreNode> {
    this.ledger.charge("allocationUnits", 1, this.signal);
    const alternatives: EreNode[] = [];
    while (true) {
      const child = await this.sequence();
      this.ledger.charge("allocationUnits", 1, this.signal);
      alternatives.push(child);
      if (!this.at("|")) break;
      this.offset++;
    }
    if (alternatives.length === 1) return alternatives[0]!;
    this.ledger.charge("work", alternatives.length * 2, this.signal);
    { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
    return this.node(() => ({ kind: "alternative", children: Object.freeze(alternatives), nullable: alternatives.some(value => value.nullable), captured: alternatives.some(value => value.captured) }));
  }

  async sequence(): Promise<EreNode> {
    this.ledger.charge("allocationUnits", 1, this.signal);
    const children: EreNode[] = [];
    while (this.offset < this.pattern.length && !this.at("|") && !this.at(")")) {
      this.ledger.charge("work", 1, this.signal);
      { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
      let child = await this.atom();
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
    { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
    return this.node(() => ({ kind: "sequence", children: Object.freeze(children), nullable: children.every(value => value.nullable), captured: children.some(value => value.captured) }));
  }

  async count(): Promise<number> {
    const begin = this.offset;
    let value = 0;
    while (!this.quoted?.[this.offset] && this.pattern[this.offset] !== undefined && this.pattern[this.offset]! >= "0" && this.pattern[this.offset]! <= "9") {
      this.ledger.charge("work", 1, this.signal);
      { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
      value = value * 10 + this.pattern.charCodeAt(this.offset++) - 48;
      if (!Number.isSafeInteger(value)) throw new EreUnsupportedError("interval count is not a safe integer", begin);
    }
    if (begin === this.offset) throw new EreSyntaxError("missing interval count", begin);
    return value;
  }

  async atom(): Promise<EreNode> {
    const begin = this.offset;
    const code = this.pattern.codePointAt(this.offset)!;
    if (code > 127) this.ascii = false;
    const character = String.fromCodePoint(code);
    this.offset += character.length;
    if (this.quoted?.[begin]) return this.node(() => ({ kind: "literal", code, insensitive: this.insensitive, nullable: false, captured: false }));
    if (character === "(") {
      if (this.at("?")) throw new EreUnsupportedError("extended group syntax", begin);
      const index = ++this.groups;
      const child = await this.expression();
      if (!this.at(")")) throw new EreSyntaxError("unclosed group", begin);
      this.offset++;
      return this.node(() => ({ kind: "group", index, child, nullable: child.nullable, captured: true }));
    }
    if (character === "[") return this.set(begin);
    if (character === "\\") {
      const escaped = this.pattern[this.offset++];
      if (escaped === undefined) throw new EreSyntaxError("trailing escape", begin);
      if (!special.includes(escaped)) throw new EreUnsupportedError("backreference or escape extension", begin);
      return this.node(() => ({ kind: "literal", code: escaped.charCodeAt(0), insensitive: this.insensitive, nullable: false, captured: false }));
    }
    if (character === "*" || character === "+" || character === "?" || character === "{") throw new EreSyntaxError("repetition without operand", begin);
    if (character === ".") return this.node(() => ({ kind: "dot", nullable: false, captured: false }));
    if (character === "^") return this.node(() => ({ kind: "start", nullable: true, captured: false }));
    if (character === "$") return this.node(() => ({ kind: "end", nullable: true, captured: false }));
    return this.node(() => ({ kind: "literal", code, insensitive: this.insensitive, nullable: false, captured: false }));
  }

  async set(begin: number): Promise<EreNode> {
    this.ledger.charge("allocationUnits", 128, this.signal);
    const members: boolean[] = new Array<boolean>(128).fill(false);
    const negate = this.at("^");
    if (negate) this.offset++;
    let first = true;
    while (this.offset < this.pattern.length) {
      this.ledger.charge("work", 1, this.signal);
      { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
      if (this.at("]") && !first) {
        this.offset++;
        if (this.insensitive) for (let upper = 65; upper <= 90; upper++) {
          this.ledger.charge("work", 1, this.signal);
          { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
          if (members[upper] || members[upper + 32]) members[upper] = members[upper + 32] = true;
        }
        if (negate) for (let code = 1; code < 128; code++) {
          this.ledger.charge("work", 1, this.signal);
          { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
          members[code] = !members[code];
        }
        return this.node(() => ({ kind: "set", members: Object.freeze(members), nonAscii: negate, nullable: false, captured: false }));
      }
      first = false;
      if (this.at("[") && (this.at(".", this.offset + 1) || this.at("=", this.offset + 1))) {
        throw new EreUnsupportedError("collating or equivalence element", this.offset);
      }
      if (this.at("[") && this.at(":", this.offset + 1)) {
        if (!this.localeProfile.classes) throw new EreUnsupportedError("locale character class", this.offset);
        const classBegin = this.offset;
        this.offset += 2;
        let name = "";
        while (this.offset < this.pattern.length && !this.at(":")) {
          this.ledger.charge("work", 1, this.signal);
          { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
          if (name.length >= 6) throw new EreSyntaxError("unknown character class", classBegin);
          name += this.pattern[this.offset++];
        }
        if (!this.at(":") || !this.at("]", this.offset + 1) || !classes.has(name)) throw new EreSyntaxError("unknown character class", classBegin);
        this.offset += 2;
        for (let code = 1; code < 128; code++) {
          this.ledger.charge("work", 1, this.signal);
          { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
          if (classMember(name, code)) members[code] = true;
        }
        if (this.at("-") && !this.at("]", this.offset + 1)) throw new EreSyntaxError("class cannot be a range endpoint", this.offset);
      } else {
        const lower = this.pattern.charCodeAt(this.offset++);
        if (lower > 127) throw new EreUnsupportedError("non-ASCII bracket member", this.offset - 1);
        if (this.at("-") && !this.at("]", this.offset + 1) && this.pattern[this.offset + 1] !== undefined) {
          if (!this.localeProfile.ranges) throw new EreUnsupportedError("collation locale range", this.offset);
          this.offset++;
          if (this.at("[")) throw new EreSyntaxError("nonliteral range endpoint", this.offset);
          const upper = this.pattern.charCodeAt(this.offset++);
          if (upper > 127) throw new EreUnsupportedError("non-ASCII bracket member", this.offset - 1);
          if (lower > upper) throw new EreSyntaxError("descending range", this.offset - 3);
          for (let code = lower; code <= upper; code++) {
            this.ledger.charge("work", 1, this.signal);
            { const c = this.ledger.checkpoint(this.signal); if (c) await c; }
            members[code] = true;
          }
        } else members[lower] = true;
      }
    }
    throw new EreSyntaxError("unclosed bracket expression", begin);
  }
}

function compilationCacheKey(input: string | readonly EreFragment[], asciiInsensitive: boolean, localeProfile: { ranges: boolean; classes: boolean }): string | undefined {
  const mode = `${asciiInsensitive ? 1 : 0}:${localeProfile.ranges ? 1 : 0}:${localeProfile.classes ? 1 : 0}`;
  if (typeof input === "string") return input.length <= 128 ? `S:${mode}:${input}` : undefined;
  if (!Array.isArray(input) || input.length === 0 || input.length > 128) return undefined;
  let length = 0;
  const fragments: [boolean, string][] = [];
  for (const fragment of input) {
    if (typeof fragment?.text !== "string" || typeof fragment?.literal !== "boolean") return undefined;
    length += fragment.text.length;
    if (length > 128) return undefined;
    fragments.push([fragment.literal, fragment.text]);
  }
  if (input.length === 1) return `F:${mode}:${input[0]!.literal ? 1 : 0}:${input[0]!.text}`;
  // Include fragment boundaries and quoting so literal and syntax fragments
  // cannot alias. The existing 256-entry cache and source cap bound retention.
  return `M:${mode}:${JSON.stringify(fragments)}`;
}

export async function compileEre(input: string | readonly EreFragment[], ledger: EreLedger, signal?: AbortSignal, asciiInsensitive = false, localeProfile = { ranges: true, classes: true }, unicode = false): Promise<EreProgram> {
  ledger.check(signal);
  if (typeof asciiInsensitive !== "boolean") throw new TypeError("ASCII case mode must be boolean");
  const baseKey = compilationCacheKey(input, asciiInsensitive, localeProfile);
  const cacheKey = baseKey === undefined ? undefined : `${unicode ? 1 : 0}:${baseKey}`;
  if (cacheKey !== undefined && ledger.charge === EreLedger.prototype.charge) {
    const cached = ereCompilationCache.get(cacheKey);
    if (
      cached &&
      ledger.workAllowanceUntilCheckpoint(signal) >= cached.work + 16 &&
      cached.patternBytes <= ledger.limits.patternBytes &&
      cached.states <= ledger.limits.states - ledger.usage.states &&
      cached.allocationUnits <= ledger.limits.allocationUnits - ledger.usage.allocationUnits
    ) {
      ledger.admitInput("patternBytes", cached.patternBytes, signal);
      if (cached.work > 0) ledger.chargeWork(cached.work, signal);
      if (cached.states > 0) ledger.charge("states", cached.states, signal);
      if (cached.allocationUnits > 0) ledger.charge("allocationUnits", cached.allocationUnits, signal);
      const c = ledger.checkpoint(signal);
      if (c) await c;
      const program = Object.freeze({ pattern: cached.pattern, groups: cached.groups, ascii: cached.ascii });
      programs.set(program, { root: cached.root, ledger });
      return program;
    }
  }
  const before = cacheKey !== undefined ? ledger.usage : undefined;
  const { pattern, quoted } = await flatten(input, ledger, signal, unicode);
  const parser = new Parser(pattern, quoted, ledger, signal, asciiInsensitive, localeProfile);
  const root = await parser.expression();
  if (parser.offset !== pattern.length) throw new EreSyntaxError("unmatched closing group", parser.offset);
  ledger.charge("allocationUnits", 4, signal);
  const program = Object.freeze({ pattern, groups: parser.groups, ascii: parser.ascii });
  programs.set(program, { root, ledger });
  if (cacheKey !== undefined && before !== undefined) {
    const after = ledger.usage;
    if (ereCompilationCache.size >= 256) ereCompilationCache.clear();
    ereCompilationCache.set(cacheKey, {
      ascii: parser.ascii,
      pattern,
      groups: parser.groups,
      root,
      patternBytes: after.patternBytes,
      work: after.work - before.work,
      states: after.states - before.states,
      allocationUnits: after.allocationUnits - before.allocationUnits,
    });
  }
  return program;
}

export function tryCompileEreSync(
  input: string | readonly EreFragment[],
  ledger: EreLedger,
  signal?: AbortSignal,
  asciiInsensitive = false,
  localeProfile: { ranges: boolean; classes: boolean } = { ranges: true, classes: true },
): EreProgram | undefined {
  const baseKey = compilationCacheKey(input, asciiInsensitive, localeProfile);
  const cacheKey = baseKey === undefined ? undefined : `0:${baseKey}`;
  if (cacheKey === undefined) return undefined;
  const cached = ereCompilationCache.get(cacheKey);
  if (
    !cached ||
    ledger.workAllowanceUntilCheckpoint(signal) < cached.work + 16 ||
    cached.patternBytes > ledger.limits.patternBytes ||
    cached.states > ledger.limits.states - ledger.usage.states ||
    cached.allocationUnits > ledger.limits.allocationUnits - ledger.usage.allocationUnits
  ) {
    return undefined;
  }
  ledger.admitInput("patternBytes", cached.patternBytes, signal);
  if (cached.work > 0) ledger.chargeWork(cached.work, signal);
  if (cached.states > 0) ledger.charge("states", cached.states, signal);
  if (cached.allocationUnits > 0) ledger.charge("allocationUnits", cached.allocationUnits, signal);
  if (ledger.checkpoint(signal)) return undefined;
  const program = Object.freeze({ pattern: cached.pattern, groups: cached.groups, ascii: cached.ascii });
  programs.set(program, { root: cached.root, ledger });
  return program;
}

export function resolveEreProgram(program: EreProgram, ledger: EreLedger): EreNode {
  const entry = programs.get(program);
  if (!entry || entry.ledger !== ledger) throw new TypeError("ERE program is not bound to this invocation ledger");
  return entry.root;
}

export function resolveEreProgramUnchecked(program: EreProgram): EreNode {
  const entry = programs.get(program);
  if (!entry) throw new TypeError("ERE program is not bound to this invocation ledger");
  return entry.root;
}
