import { PythonSource, PythonSyntaxError } from "./source.js";
import type { SourcePosition,SourceMeter } from "./source.js";
import {maximumIndentationLevels} from "./lexical-limits.js";

export class PythonIndentationError extends PythonSyntaxError {
  constructor(message: string, filename: string, position: SourcePosition, endPosition?: SourcePosition) {
    super(message, filename, position, endPosition);
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
  private readonly levels:Array<{width:number;alternate:number}>;

  constructor(meter:SourceMeter|undefined=undefined){
    meter?.checkpoint(1,128);
    this.levels=[{width:0,alternate:0}];
  }

  accept(whitespace: string, source: PythonSource,start?:SourcePosition): IndentationToken[] {
    try {
    source.meter?.checkpoint(1,32);
    let width = 0;
    let alternate = 0;
    for (const character of whitespace) {
      source.meter?.checkpoint();
      switch (character) {
        case " ": width++; alternate++; break;
        case "\t": width += 8 - width % 8; alternate++; break;
        case "\f": width = 0; alternate = 0; break;
        default: throw new TypeError("indentation must contain only spaces, tabs, or form feeds");
      }
    }

    const current = this.levels[this.levels.length - 1];
    if (width > current.width) {
      if(this.levels.length>=maximumIndentationLevels){source.meter?.checkpoint(0,320);throw new PythonIndentationError("too many levels of indentation",source.filename,start??source.position);}
      if (alternate <= current.alternate) {source.meter?.checkpoint(0,320);throw new PythonTabError(source.filename, source.position);}
      source.meter?.checkpoint(0,64);
      this.levels.push({ width, alternate });
      return ["INDENT"];
    }

    let target = this.levels.length - 1;
    while (this.levels[target].width > width) {source.meter?.checkpoint();target--;}
    if (this.levels[target].width !== width) {
      source.meter?.checkpoint(0,320);
      throw new PythonIndentationError(
        "unindent does not match any outer indentation level", source.filename, source.position
      );
    }
    if (this.levels[target].alternate !== alternate) {
      source.meter?.checkpoint(0,320);
      throw new PythonTabError(source.filename, source.position);
    }
    const count = this.levels.length - target - 1;
    source.meter?.checkpoint(count,8*count);
    this.levels.length = target + 1;
    return Array<IndentationToken>(count).fill("DEDENT");
    } finally {source.meter?.checkpoint();}
  }

  finish(meter:SourceMeter|undefined=undefined): IndentationToken[] {
    try {
    const count = this.levels.length - 1;
    meter?.checkpoint(1+count,32+8*count);
    this.levels.length = 1;
    return Array<IndentationToken>(count).fill("DEDENT");
    } finally {meter?.checkpoint();}
  }
}
