/** Offsets address the original JavaScript string; columns count Unicode code points. */
export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

/** Cooperative source/cursor accounting, structurally compatible with runtime
 * execution meters without coupling the parser to a runtime implementation. */
export interface SourceMeter {
  checkpoint(steps?:number,allocatedBytes?:number):void;
}

export class PythonSyntaxError extends SyntaxError {
  readonly filename: string;
  readonly position: SourcePosition;
  readonly endPosition: SourcePosition | undefined;
  #sourceLine: string | undefined;

  constructor(message: string, filename: string, position: SourcePosition, endPosition?: SourcePosition) {
    super(message);
    this.name = "SyntaxError";
    this.filename = filename;
    this.position = { ...position };
    this.endPosition = endPosition === undefined ? undefined : { ...endPosition };
  }

  get sourceLine(): string | undefined { return this.#sourceLine; }

  /** Retain only the physical diagnostic line, never the entire input. Repeated
   * parser/analysis boundaries must not replace an already attributed line.
   * Token-parser errors include the lexer's implicit final newline. */
  withSource(text: string, implicitNewline = false, meter?:SourceMeter): this {
    meter?.checkpoint();
    if (this.#sourceLine !== undefined) return this;
    const offset = this.position.offset;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) return this;
    let start = offset, end = offset;
    while (start > 0 && text[start - 1] !== "\n" && text[start - 1] !== "\r") {meter?.checkpoint();start--;}
    while (end < text.length && text[end] !== "\n" && text[end] !== "\r") {meter?.checkpoint();end++;}
    if (start === 0 && text[0] === "\uFEFF") start++;
    meter?.checkpoint(0,32+2*(end-start+1));
    this.#sourceLine = text.slice(start, end) + (end < text.length || implicitNewline ? "\n" : "");
    return this;
  }
}

/** A code-point cursor with universal newlines and no normalized source copy. */
export class PythonSource {
  private offset: number;
  private line = 1;
  private column = 0;

  constructor(readonly text: string, readonly filename = "<string>",private readonly meter?:SourceMeter) {
    meter?.checkpoint(1+text.length,64);
    this.offset = text.startsWith("\uFEFF") ? 1 : 0;
    const nul = text.indexOf("\0");
    if (nul !== -1) {
      while (this.offset < nul) this.advance();
      throw this.error("source code cannot contain null bytes");
    }
  }

  get position(): SourcePosition {
    this.meter?.checkpoint(0,32);
    return { offset: this.offset, line: this.line, column: this.column };
  }

  get done(): boolean {
    this.meter?.checkpoint();
    return this.offset >= this.text.length;
  }

  peek(distance = 0): string {
    this.meter?.checkpoint();
    if (!Number.isSafeInteger(distance) || distance < 0) {
      throw new RangeError("lookahead distance must be a non-negative safe integer");
    }
    let offset = this.offset;
    for (let index = 0; index < distance && offset < this.text.length; index++) {
      this.meter?.checkpoint();
      offset += this.widthAt(offset);
    }
    const point = this.text.codePointAt(offset);
    return point === undefined ? "" : point === 13 ? "\n" : String.fromCodePoint(point);
  }

  advance(): string {
    this.meter?.checkpoint();
    const character = this.peek();
    if (character === "") return character;
    this.offset += this.widthAt(this.offset);
    if (character === "\n") {
      this.line++;
      this.column = 0;
    } else {
      this.column++;
    }
    return character;
  }

  error(message: string, position: SourcePosition = this.position): PythonSyntaxError {
    this.meter?.checkpoint(0,160+2*message.length);
    return new PythonSyntaxError(message, this.filename, position).withSource(this.text,false,this.meter);
  }

  private widthAt(offset: number): number {
    if (this.text[offset] === "\r" && this.text[offset + 1] === "\n") return 2;
    return (this.text.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
  }
}
