import type { Token } from "./lexer.js";
import { PythonSyntaxError } from "./source.js";

/** Bounded lookahead over the lazy lexer; no whole-program token array is needed. */
export class TokenCursor {
  private buffered: Token | undefined;
  constructor(private readonly tokens: Iterator<Token>, private readonly filename = "<string>") {}

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
