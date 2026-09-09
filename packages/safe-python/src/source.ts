/** Offsets address the original JavaScript string; columns count Unicode code points. */
export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export class PythonSyntaxError extends SyntaxError {
  readonly filename: string;
  readonly position: SourcePosition;

  constructor(message: string, filename: string, position: SourcePosition) {
    super(message);
    this.name = "SyntaxError";
    this.filename = filename;
    this.position = { ...position };
  }
}

/** A code-point cursor with universal newlines and no normalized source copy. */
export class PythonSource {
  private offset: number;
  private line = 1;
  private column = 0;

  constructor(readonly text: string, readonly filename = "<string>") {
    this.offset = text.startsWith("\uFEFF") ? 1 : 0;
    const nul = text.indexOf("\0");
    if (nul !== -1) {
      while (this.offset < nul) this.advance();
      throw this.error("source code cannot contain null bytes");
    }
  }

  get position(): SourcePosition {
    return { offset: this.offset, line: this.line, column: this.column };
  }

  get done(): boolean {
    return this.offset >= this.text.length;
  }

  peek(distance = 0): string {
    if (!Number.isSafeInteger(distance) || distance < 0) {
      throw new RangeError("lookahead distance must be a non-negative safe integer");
    }
    let offset = this.offset;
    for (let index = 0; index < distance && offset < this.text.length; index++) {
      offset += this.widthAt(offset);
    }
    const point = this.text.codePointAt(offset);
    return point === undefined ? "" : point === 13 ? "\n" : String.fromCodePoint(point);
  }

  advance(): string {
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
    return new PythonSyntaxError(message, this.filename, position);
  }

  private widthAt(offset: number): number {
    if (this.text[offset] === "\r" && this.text[offset + 1] === "\n") return 2;
    return (this.text.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
  }
}
