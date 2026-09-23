import type { Token, TokenType } from "./tokenizer.js";
import type { CompactSourcePositions } from "./compact-spans.js";

const types: readonly TokenType[] = [
  "identifier",
  "private-identifier",
  "keyword",
  "escaped-keyword",
  "numeric",
  "regex",
  "string",
  "template",
  "punctuator",
  "eof"
];
const stride = 3;
const legacyEscape = 256;
const tokenCacheSize = 256;

/** Private indexed compiler storage; the public tokenizer stays eager. */
export class CompactTokens {
  private rows = new Uint32Array(1024 * stride);
  private readonly values: string[] = [];
  private readonly templates = new Map<number, Token["templateExpressions"]>();
  private readonly tokens = new Map<number, Token>();
  private last?: Token;

  constructor(private readonly sourcePositions: CompactSourcePositions) {}

  // Only indexing, iteration, length, push and at are used by the lexer/parser.
  // Historical tokens are materialized on demand in a bounded cache.
  readonly indexed: Token[] = new Proxy([] as Token[], {
    get: (target, key, receiver) => {
      if (key === "length") return this.values.length;
      if (key === "push") return this.push;
      const index = arrayIndex(key);
      return index === undefined ? Reflect.get(target, key, receiver) : this.get(index);
    },
    set: () => {
      throw new TypeError("Compiler token rows cannot be reassigned.");
    }
  });

  finish(): Token[] {
    // Parsing needs every token's row initially, but not spare growth capacity.
    this.rows = this.rows.slice(0, this.values.length * stride);
    if (this.last) {
      this.last.start = this.sourcePositions.position(this.last.start.offset);
      this.last.end = this.sourcePositions.position(this.last.end.offset);
    }
    return this.indexed;
  }

  private push = (token: Token): number => {
    // String/template scanners annotate the last token after publishing it.
    // Commit those annotations before that token becomes a historical row.
    if (this.last !== undefined) {
      const previous = this.values.length - 1;
      if (this.last.legacyEscape) this.rows[previous * stride + 2] |= legacyEscape;
      if (this.last.templateExpressions !== undefined)
        this.templates.set(previous, this.last.templateExpressions);
    }
    const index = this.values.length;
    const base = index * stride;
    if (base + stride > this.rows.length) {
      const rows = new Uint32Array(this.rows.length * 2);
      rows.set(this.rows);
      this.rows = rows;
    }
    this.rows.set([token.start.offset, token.end.offset, types.indexOf(token.type)], base);
    this.values.push(token.value);
    this.last = token;
    return index + 1;
  };

  private get(index: number): Token | undefined {
    if (index >= this.values.length) return undefined;
    if (index === this.values.length - 1) return this.last;
    const cached = this.tokens.get(index);
    if (cached !== undefined) return cached;
    const base = index * stride;
    const bits = this.rows[base + 2]!;
    const token: Token = {
      type: types[bits & 255]!,
      value: this.values[index]!,
      start: this.sourcePositions.position(this.rows[base]!),
      end: this.sourcePositions.position(this.rows[base + 1]!)
    };
    if (bits & legacyEscape) token.legacyEscape = true;
    const expressions = this.templates.get(index);
    if (expressions !== undefined) token.templateExpressions = expressions;
    if (this.tokens.size === tokenCacheSize) this.tokens.delete(this.tokens.keys().next().value!);
    this.tokens.set(index, token);
    return token;
  }
}

function arrayIndex(key: string | symbol): number | undefined {
  if (typeof key !== "string") return undefined;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && String(index) === key ? index : undefined;
}
