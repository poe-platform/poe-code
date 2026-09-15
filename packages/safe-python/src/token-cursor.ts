import type { Token } from "./lexer.js";
import { lex } from "./lexer.js";
import type { LexerOptions } from "./lexer.js";
import { PythonSyntaxError,type SourceMeter } from "./source.js";
import type { SourceSpan } from "./ast.js";
import {normalizeFutureFlags} from "./future-flags.js";

export function createTokenCursor(text: string, options: LexerOptions = {}, mode: "exec" | "eval" = "exec"): TokenCursor {
  options.meter?.checkpoint(1,64);
  const futureFlags=normalizeFutureFlags(options.futureFlags,options.meter);
  const comments: SourceSpan[] = [];
  options.meter?.checkpoint(0,32);
  const tokenization = {syntaxOnly: false,implicitNewline:mode==="exec"};
  const tokens = lex(text, { ...options, tokenization, onComment: span => { options.meter?.checkpoint(1,8);comments.push(span); options.onComment?.(span); } });
  const cursor=new TokenCursor(tokens, options.filename, text, comments,options.meter,options.enterRecursiveCall,mode,tokenization);
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
  constructor(private readonly tokens: Iterator<Token>, readonly filename = "<string>", private readonly sourceText = "", private readonly comments: readonly SourceSpan[] = [],readonly meter?:SourceMeter,readonly enterRecursiveCall?:()=>()=>void,private readonly mode: "exec" | "eval" = "exec", private readonly tokenization?: {syntaxOnly: boolean}) {meter?.checkpoint(1,144);}

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
        if (error instanceof PythonSyntaxError) {
          if (error.unclosedDelimiter) {
            let start = error.position.offset, end = start;
            while (start > 0 && this.sourceText[start - 1] !== "\n" && this.sourceText[start - 1] !== "\r") {this.meter?.checkpoint(); start--;}
            while (end < this.sourceText.length && this.sourceText[end] !== "\n" && this.sourceText[end] !== "\r") {this.meter?.checkpoint(); end++;}
            let after = end;
            if (this.sourceText[after] === "\r") after++;
            if (this.sourceText[after] === "\n") after++;
            this.meter?.checkpoint(0, 32 + 2 * (end - start));
            error.withSourceLine(this.sourceText.slice(start, end) + (after === this.sourceText.length && (end < after || this.mode === "exec") ? "\n" : ""), this.meter);
          }
          error.withSource(this.sourceText,false,this.meter);
        }
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

  /** Finish the existing tokenizer after a parser error, without replaying
   * warnings/comments or grammar callbacks. Resource/service failures remain
   * fatal. A tokenizer error already observed by the parser is not replaced. */
  finishSyntaxError(error: PythonSyntaxError): PythonSyntaxError {
    this.meter?.checkpoint();
    if (this.lexerFailure !== undefined) return error;
    if (this.tokenization !== undefined) this.tokenization.syntaxOnly = true;
    try {
      while (this.peek().kind !== "end") this.take();
    } catch (failure) {
      if (!(failure instanceof PythonSyntaxError)) throw failure;
      if (failure.tokenizerPriority === "always" ||
        (failure.tokenizerPriority === "earlier-line" && failure.position.line < error.position.line)) return failure;
    }
    return error;
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

  /** Parser NEWLINE diagnostics include a trailing comment and keep the end
   * column on that physical line. Eval's synthetic EOF newline has no span;
   * an explicit invalid-grammar rule instead attributes its next token. */
  newlineError(message = "invalid syntax", nextToken = false): PythonSyntaxError {
    const token = this.peek();
    if (token.kind !== "newline") throw new Error("newline diagnostic requires a newline token");
    this.meter?.checkpoint(1, 256 + 2 * message.length);
    let start = token.start;
    let end = {...token.start, column: token.start.column + 1};
    if (this.mode === "eval" && token.text === "") {
      start = {...start, column: nextToken ? start.column - 1 : -1};
      end = {...end, column: nextToken ? -2 : -1};
    } else {
      // Speculative grammar reads may have already scanned later comments.
      let low = 0, high = this.comments.length;
      while (low < high) {
        this.meter?.checkpoint();
        const middle = Math.floor((low + high) / 2);
        if (this.comments[middle].end.offset < token.start.offset) low = middle + 1;
        else high = middle;
      }
      const comment = this.comments[low];
      if (comment?.end.offset === token.start.offset && comment.start.line === token.start.line) start = comment.start;
    }
    return new PythonSyntaxError(message, this.filename, start, end).withSource(this.sourceText, this.mode === "exec", this.meter);
  }

  error(message = "invalid syntax", ErrorType: typeof PythonSyntaxError = PythonSyntaxError): PythonSyntaxError {
    const token = this.peek();
    this.meter?.checkpoint(0,160+2*message.length);
    return new ErrorType(message, this.filename, token.start, token.end).withSource(this.sourceText, true,this.meter);
  }
}
