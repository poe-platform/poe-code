import type { Token } from "./lexer.js";
import { lex } from "./lexer.js";
import type { LexerOptions } from "./lexer.js";
import { PythonSyntaxError,type SourceMeter } from "./source.js";
import type { SourceSpan } from "./ast.js";
import {normalizeFutureFlags} from "./future-flags.js";

export function createTokenCursor(text: string, options: LexerOptions = {}): TokenCursor {
  options.meter?.checkpoint(1,64);
  const futureFlags=normalizeFutureFlags(options.futureFlags,options.meter);
  const comments: SourceSpan[] = [];
  const tokens = lex(text, { ...options, onComment: span => { options.meter?.checkpoint(1,8);comments.push(span); options.onComment?.(span); } });
  const cursor=new TokenCursor(tokens, options.filename, text, comments,options.meter,options.enterRecursiveCall);
  if(futureFlags&0x400000){options.meter?.checkpoint(1,32);cursor.futureFeatures.add("barry_as_FLUFL");}
  return cursor;
}

/** Lazy tokens, retaining consumed tokens only while a grammar alternative needs them. */
export class TokenCursor {
  readonly futureFeatures = new Set<string>();
  private buffered: Token[] = [];
  private offset = 0;
  private attempts = 0;
  private lexerFailure: unknown;
  constructor(private readonly tokens: Iterator<Token>, private readonly filename = "<string>", private readonly sourceText = "", private readonly comments: readonly SourceSpan[] = [],readonly meter?:SourceMeter,readonly enterRecursiveCall?:()=>()=>void) {meter?.checkpoint(1,136);}

  /** Retrieve original spelling, excluding lexer-identified comments only. */
  sourceBetween(start: number, end: number): string {
    this.meter?.checkpoint(1,72+8*Math.max(0,end-start));
    let low = 0;
    let high = this.comments.length;
    while (low < high) {
      this.meter?.checkpoint();
      const middle = Math.floor((low + high) / 2);
      if (this.comments[middle].end.offset <= start) low = middle + 1;
      else high = middle;
    }
    const parts: string[] = [];
    let offset = start;
    for (let index = low; index < this.comments.length && this.comments[index].start.offset < end; index++) {
      this.meter?.checkpoint(1,8);
      const comment = this.comments[index];
      parts.push(this.sourceText.slice(offset, Math.max(offset, comment.start.offset)));
      offset = Math.min(end, comment.end.offset);
    }
    parts.push(this.sourceText.slice(offset, end));
    return parts.join("").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  }

  peek(): Token {
    this.meter?.checkpoint();
    if (this.offset === this.buffered.length) {
      if (this.lexerFailure) throw this.lexerFailure;
      try {
        const next = this.tokens.next();
        if (next.done) throw new Error("token stream ended without an end marker");
        this.meter?.checkpoint(0,8);this.buffered.push(next.value);
      } catch (error) {
        this.meter?.checkpoint();
        if (error instanceof PythonSyntaxError) error.withSource(this.sourceText,false,this.meter);
        this.lexerFailure = error; throw error;
      }
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
    this.meter?.checkpoint();
    const offset = this.offset;
    this.attempts++;
    try { return read(); }
    catch (error) {
      if (!(error instanceof PythonSyntaxError)) throw error;
      this.offset = offset;
      return undefined;
    } finally { this.attempts--; this.releaseConsumed();this.meter?.checkpoint(); }
  }

  private releaseConsumed(): void {
    if (this.attempts || !this.offset) return;
    if (this.offset === this.buffered.length) { this.buffered.length = 0; this.offset = 0; }
    else if (this.offset >= this.buffered.length / 2) {
      this.meter?.checkpoint(0,32+8*(this.buffered.length-this.offset));
      this.buffered = this.buffered.slice(this.offset);
      this.offset = 0;
    }
  }

  expect(text: string): Token {
    if (this.peek().text !== text) throw this.error(`expected '${text}'`);
    return this.take();
  }

  error(message = "invalid syntax"): PythonSyntaxError {
    const token = this.peek();
    this.meter?.checkpoint(0,160+2*message.length);
    return new PythonSyntaxError(message, this.filename, token.start, token.end).withSource(this.sourceText, true,this.meter);
  }
}
