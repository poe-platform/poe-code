import { PythonSource, PythonSyntaxError } from "./source.js";
import type { SourcePosition } from "./source.js";

export class PythonIndentationError extends PythonSyntaxError {
  constructor(message: string, filename: string, position: SourcePosition) {
    super(message, filename, position);
    this.name = "IndentationError";
  }
}

export class PythonTabError extends PythonIndentationError {
  constructor(filename: string, position: SourcePosition) {
    super("inconsistent use of tabs and spaces in indentation", filename, position);
    this.name = "TabError";
  }
}

export type IndentationToken = "INDENT" | "DEDENT";

/** The lexer calls accept only for nonblank logical lines outside delimiters. */
export class Indentation {
  private readonly levels = [{ width: 0, alternate: 0 }];

  accept(whitespace: string, source: PythonSource): IndentationToken[] {
    let width = 0;
    let alternate = 0;
    for (const character of whitespace) {
      switch (character) {
        case " ": width++; alternate++; break;
        case "\t": width += 8 - width % 8; alternate++; break;
        case "\f": width = 0; alternate = 0; break;
        default: throw new TypeError("indentation must contain only spaces, tabs, or form feeds");
      }
    }

    const current = this.levels[this.levels.length - 1];
    if (width > current.width) {
      if (alternate <= current.alternate) throw new PythonTabError(source.filename, source.position);
      this.levels.push({ width, alternate });
      return ["INDENT"];
    }

    let target = this.levels.length - 1;
    while (this.levels[target].width > width) target--;
    if (this.levels[target].width !== width) {
      throw new PythonIndentationError(
        "unindent does not match any outer indentation level", source.filename, source.position
      );
    }
    if (this.levels[target].alternate !== alternate) {
      throw new PythonTabError(source.filename, source.position);
    }
    const count = this.levels.length - target - 1;
    this.levels.length = target + 1;
    return Array.from({ length: count }, () => "DEDENT");
  }

  finish(): IndentationToken[] {
    const count = this.levels.length - 1;
    this.levels.length = 1;
    return Array.from({ length: count }, () => "DEDENT");
  }
}
