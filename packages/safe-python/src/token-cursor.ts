import type { Token } from "./lexer.js";
import { lex } from "./lexer.js";
import type { LexerOptions } from "./lexer.js";
import { PythonSyntaxError } from "./source.js";
import type { SourceSpan } from "./ast.js";

export function createTokenCursor(text: string, options: LexerOptions = {}): TokenCursor {
  const comments: SourceSpan[] = [];
  const tokens = lex(text, { ...options, onComment: span => { comments.push(span); options.onComment?.(span); } });
  return new TokenCursor(tokens, options.filename, text, comments);
}

/** Lazy tokens, retaining consumed tokens only while a grammar alternative needs them. */
export class TokenCursor {
  readonly futureFeatures = new Set<string>();
  private buffered: Token[] = [];
  private offset = 0;
  private attempts = 0;
  private lexerFailure: unknown;
  constructor(private readonly tokens: Iterator<Token>, private readonly filename = "<string>", private readonly sourceText = "", private readonly comments: readonly SourceSpan[] = []) {}

  /** Retrieve original spelling, excluding lexer-identified comments only. */
  sourceBetween(start: number, end: number): string {
    let low = 0;
    let high = this.comments.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.comments[middle].end.offset <= start) low = middle + 1;
      else high = middle;
    }
    const parts: string[] = [];
    let offset = start;
    for (let index = low; index < this.comments.length && this.comments[index].start.offset < end; index++) {
      const comment = this.comments[index];
      parts.push(this.sourceText.slice(offset, Math.max(offset, comment.start.offset)));
      offset = Math.min(end, comment.end.offset);
    }
    parts.push(this.sourceText.slice(offset, end));
    return parts.join("").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  }

  peek(): Token {
    if (this.offset === this.buffered.length) {
      if (this.lexerFailure) throw this.lexerFailure;
      try {
        const next = this.tokens.next();
        if (next.done) throw new Error("token stream ended without an end marker");
        this.buffered.push(next.value);
      } catch (error) { this.lexerFailure = error; throw error; }
    }
    return this.buffered[this.offset];
  }

  take(): Token {
    const token = this.peek();
    if (token.kind !== "end") { this.offset++; this.releaseConsumed(); }
    return token;
  }

  /** Try an ordered grammar alternative; lexical side effects happen only once. */
  attempt<T>(read: () => T): T | undefined {
    const offset = this.offset;
    this.attempts++;
    try { return read(); }
    catch (error) {
      if (!(error instanceof PythonSyntaxError)) throw error;
      this.offset = offset;
      return undefined;
    } finally { this.attempts--; this.releaseConsumed(); }
  }

  private releaseConsumed(): void {
    if (this.attempts || !this.offset) return;
    if (this.offset === this.buffered.length) { this.buffered.length = 0; this.offset = 0; }
    else if (this.offset >= this.buffered.length / 2) {
      this.buffered = this.buffered.slice(this.offset);
      this.offset = 0;
    }
  }

  expect(text: string): Token {
    if (this.peek().text !== text) throw this.error(`expected '${text}'`);
    return this.take();
  }

  error(message = "invalid syntax"): PythonSyntaxError {
    return new PythonSyntaxError(message, this.filename, this.peek().start);
  }
}
