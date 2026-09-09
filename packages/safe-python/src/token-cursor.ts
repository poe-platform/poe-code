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

/** Bounded lookahead over the lazy lexer; no whole-program token array is needed. */
export class TokenCursor {
  private buffered: Token | undefined;
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
    if (!this.buffered) {
      const next = this.tokens.next();
      if (next.done) throw new Error("token stream ended without an end marker");
      this.buffered = next.value;
    }
    return this.buffered;
  }

  take(): Token {
    const token = this.peek();
    if (token.kind !== "end") this.buffered = undefined;
    return token;
  }

  expect(text: string): Token {
    if (this.peek().text !== text) throw this.error(`expected '${text}'`);
    return this.take();
  }

  error(message = "invalid syntax"): PythonSyntaxError {
    return new PythonSyntaxError(message, this.filename, this.peek().start);
  }
}
