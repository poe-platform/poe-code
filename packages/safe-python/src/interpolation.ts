import type { PythonSource, SourcePosition,SourceMeter } from "./source.js";
import { PythonSyntaxError } from "./source.js";
import type { StructuralToken } from "./lexer.js";
import { escapeWarning, readEscape } from "./strings.js";
import {maximumDelimiterDepth,maximumInterpolatedStringLevels} from "./lexical-limits.js";
import {decodeInterpolatedLiteral} from "./interpolated-literal-decoding.js";

export type InterpolatedToken = {
  readonly text: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
} & (
  | { readonly kind: "fstring-start" | "fstring-end" | "tstring-start" | "tstring-end" }
  | {
    readonly kind: "fstring-middle" | "tstring-middle";
    /** Universal newlines and collapsed doubled braces, retaining escape spelling. */
    readonly content: string;
    /** Decoded Python code points, including distinct escaped surrogates. */
    readonly value: Uint32Array;
    /** Parser-owned reduction; standalone lexer callers retain eager values. */
    readonly decodeAt?: (span:{readonly start:SourcePosition;readonly end:SourcePosition})=>Uint32Array;
  }
);

interface QuotedMode {
  mode: "literal";
  flavor: "fstring" | "tstring";
  quote: string;
  triple: boolean;
  raw: boolean;
  start: SourcePosition;
}

interface FieldMode {
  mode: "field" | "format";
  owner: QuotedMode;
  depth: number;
  start: SourcePosition;
}

/** The outer lexer handles expressions; this stack handles literal/format boundaries. */
export class Interpolation {
  private readonly modes: Array<QuotedMode | FieldMode>;
  private quotedDepth=0;
  private fields=0;

  constructor(meter:SourceMeter|undefined=undefined,private readonly deferDecoding=false,private readonly implicitNewline=true){meter?.checkpoint(1,96);this.modes=[];}

  get replacementDepth():number {return this.fields;}

  get active(): boolean { return this.modes.length > 0; }
  get inText(): boolean {
    const mode = this.modes[this.modes.length - 1];
    return mode !== undefined && mode.mode !== "field";
  }
  get fieldDepth(): number | undefined {
    const mode = this.modes[this.modes.length - 1];
    return mode?.mode === "field" ? mode.depth : undefined;
  }

  begin(source: PythonSource): InterpolatedToken {
    try {
    source.meter?.checkpoint(1,192);
    const start = source.position;
    let prefix = source.advance().toLowerCase();
    if (source.peek() !== "'" && source.peek() !== '"') prefix += source.advance().toLowerCase();
    let quotePosition=source.position;
    const quote = source.advance();
    const triple = source.peek() === quote && source.peek(1) === quote;
    if (triple) { source.advance();quotePosition=source.position; source.advance(); }
    const flavor = prefix.includes("f") ? "fstring" : "tstring";
    if(this.quotedDepth+1>=maximumInterpolatedStringLevels)throw source.error("too many nested f-strings or t-strings",quotePosition);
    source.meter?.checkpoint(0,88);
    this.quotedDepth++;
    this.modes.push({ mode: "literal", flavor, quote, triple, raw: prefix.includes("r"), start });
    const end=source.position;
    source.meter?.checkpoint(1+end.offset-start.offset,32+2*(end.offset-start.offset));
    return { kind: `${flavor}-start`, text: source.text.slice(start.offset, end.offset), start, end };
    } finally {source.meter?.checkpoint();}
  }

  boundary(source: PythonSource, depth: number): StructuralToken | undefined {
    try {
    source.meter?.checkpoint();
    const mode = this.modes[this.modes.length - 1];
    if (mode?.mode !== "field" || mode.depth !== depth) return undefined;
    const character = source.peek();
    if (character !== ":" && character !== "}") return undefined;
    source.meter?.checkpoint(0,64);
    const start = source.position;
    source.advance();
    if (character === ":") mode.mode = "format";
    else {this.modes.pop();this.fields--;}
    return { kind: "operator", text: character, start, end: source.position };
    } finally {source.meter?.checkpoint();}
  }

  readText(source: PythonSource, depth: number, onWarning?: (message: string, position: SourcePosition) => void): InterpolatedToken | StructuralToken;
  readText(source: PythonSource, depth: number, onWarning: ((message: string, position: SourcePosition) => void) | undefined, decode: boolean): InterpolatedToken | StructuralToken | undefined;
  readText(source: PythonSource, depth: number, onWarning?: (message: string, position: SourcePosition) => void, decode = true): InterpolatedToken | StructuralToken | undefined {
    try {
    source.meter?.checkpoint(1,224);
    const mode = this.modes[this.modes.length - 1];
    if (!mode || mode.mode === "field") throw new Error("interpolation text mode required");
    const owner = mode.mode === "literal" ? mode : mode.owner;
    const start = source.position;
    let content = "";
    const points: number[] = [];
    let warning: { message: string; position: SourcePosition } | undefined;
    const warn = (escape: string, position: SourcePosition, octal = false): void => {
      if(warning)return;
      source.meter?.checkpoint(0,48);
      warning = { message: escapeWarning(escape, octal,source.meter), position };
    };
    while (!source.done) {
      const character = source.peek();
      const closingQuote = character === owner.quote &&
        (!owner.triple || (source.peek(1) === owner.quote && source.peek(2) === owner.quote));
      if (closingQuote) {
        if (mode.mode === "format") throw source.error("expecting '}' in format specification", mode.start);
        if (source.position.offset !== start.offset) break;
        source.advance();
        if (owner.triple) { source.advance(); source.advance(); }
        this.modes.pop();
        this.quotedDepth--;
        const end=source.position;
        source.meter?.checkpoint(1+end.offset-start.offset,32+2*(end.offset-start.offset));
        return { kind: `${owner.flavor}-end`, text: source.text.slice(start.offset, end.offset), start, end };
      }
      if (character === "\n" && !owner.triple) throw source.error("unterminated interpolated string literal", owner.start);
      if (character === "{" || character === "}") {
        if (mode.mode === "literal" && source.peek(1) === character) {
          source.meter?.checkpoint(0,72+2*character.length);
          source.advance(); source.advance(); content += character; points.push(character.codePointAt(0)!);
          if(this.deferDecoding)break;
          continue;
        }
        if (character === "}" && mode.mode === "literal") throw source.error("single '}' is not allowed in interpolated strings");
        if (source.position.offset !== start.offset) break;
        if(character==="{"&&depth+this.fields>=maximumDelimiterDepth)throw source.error("too many nested parentheses",start);
        source.advance();
        if (character === "{") {source.meter?.checkpoint(0,72);this.modes.push({ mode: "field", owner, depth, start });this.fields++;}
        else {this.modes.pop();this.fields--;}
        return { kind: "operator", text: character, start, end: source.position };
      }
      const position = source.position;
      source.meter?.checkpoint(0,64+2*character.length);
      content += source.advance();
      if (character === "\\" && !source.done) {
        // Braces are never backslash-escaped in f/t strings. Named Unicode escapes
        // are the exception: their braces belong to the escape, not a field.
        const next = source.peek();
        if (next === "{" || next === "}") {
          source.meter?.checkpoint(0,8);
          points.push(92);
          if (decode && !owner.raw) warn(next, position);
          continue;
        }
        if (!decode || this.deferDecoding) {
          const escapeStart=source.position.offset;
          let namedEnd=false;
          source.advance();
          // Named-escape braces remain literal text even while semantic
          // decoding is disabled. Quote/newline boundaries still belong to
          // the tokenizer; malformed names must not consume following code.
          if (!owner.raw && next === "N" && source.peek() === "{") {
            source.advance();
            while (!source.done && source.peek() !== "}" && source.peek() !== owner.quote && source.peek() !== "\n") source.advance();
            if (source.peek() === "}") {source.advance();namedEnd=true;}
          }
          if(decode){
            const width=source.position.offset-escapeStart;
            source.meter?.checkpoint(width,160+6*width);
            content+=source.text.slice(escapeStart,source.position.offset).replaceAll("\r\n","\n").replaceAll("\r","\n");
          }
          if(this.deferDecoding&&namedEnd)break;
        }
        else if (owner.raw) { source.meter?.checkpoint(0,80+2*next.length);content += source.advance(); points.push(92, next.codePointAt(0)!); }
        else {
          const escapeStart = source.position.offset;
          const escaped=readEscape(source,false,position,warn);
          source.meter?.checkpoint(escaped.length,8*escaped.length);
          for(let index=0;index<escaped.length;index++)points.push(escaped[index]);
          const escapeEnd=source.position.offset,width=escapeEnd-escapeStart;
          source.meter?.checkpoint(1+3*width,160+6*width);
          content += source.text.slice(escapeStart, escapeEnd).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
        }
      } else {source.meter?.checkpoint(0,8);points.push(character.codePointAt(0)!);}
    }
    if (source.position.offset === start.offset) this.assertClosed(source);
    if (!decode) return;
    if (warning) onWarning?.(warning.message, warning.position);
    const end=source.position,width=end.offset-start.offset;
    source.meter?.checkpoint(1+width+content.length+points.length,128+2*width+2*content.length+4*points.length);
    if(this.deferDecoding){
      const decodeAt=(span:{readonly start:SourcePosition;readonly end:SourcePosition})=>decodeInterpolatedLiteral(content,owner.raw,source,span,mode.mode==="format",this.implicitNewline,onWarning);
      return {kind:`${owner.flavor}-middle`,text:source.text.slice(start.offset,end.offset),content,
        get value(){return decodeAt({start,end});},decodeAt,start,end};
    }
    return {
      kind: `${owner.flavor}-middle`, text: source.text.slice(start.offset, end.offset),
      content, value: Uint32Array.from(points), start, end
    };
    } finally {source.meter?.checkpoint();}
  }

  assertClosed(source: PythonSource): void {
    try {
    source.meter?.checkpoint();
    const mode = this.modes[this.modes.length - 1];
    if (mode?.mode === "field") {
      source.meter?.checkpoint(0,192);
      const error = new PythonSyntaxError("'{' was never closed", source.filename, mode.start, {...mode.start, column: -1});
      error.unclosedDelimiter = true;
      throw error;
    }
    if (mode) throw source.error(mode.mode === "literal" ? "unterminated interpolated string literal" : "expecting '}' in interpolated string", mode.start);
    } finally {source.meter?.checkpoint();}
  }
}
