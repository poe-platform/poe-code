import type { PythonSource, SourcePosition } from "./source.js";
import type { StructuralToken } from "./lexer.js";
import { escapeWarning, readEscape } from "./strings.js";

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
  private readonly modes: Array<QuotedMode | FieldMode> = [];

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
    const start = source.position;
    let prefix = source.advance().toLowerCase();
    if (source.peek() !== "'" && source.peek() !== '"') prefix += source.advance().toLowerCase();
    const quote = source.advance();
    const triple = source.peek() === quote && source.peek(1) === quote;
    if (triple) { source.advance(); source.advance(); }
    const flavor = prefix.includes("f") ? "fstring" : "tstring";
    this.modes.push({ mode: "literal", flavor, quote, triple, raw: prefix.includes("r"), start });
    return { kind: `${flavor}-start`, text: source.text.slice(start.offset, source.position.offset), start, end: source.position };
  }

  boundary(source: PythonSource, depth: number): StructuralToken | undefined {
    const mode = this.modes[this.modes.length - 1];
    if (mode?.mode !== "field" || mode.depth !== depth) return undefined;
    const character = source.peek();
    if (character !== ":" && character !== "}") return undefined;
    const start = source.position;
    source.advance();
    if (character === ":") mode.mode = "format";
    else this.modes.pop();
    return { kind: "operator", text: character, start, end: source.position };
  }

  readText(source: PythonSource, depth: number, onWarning?: (message: string, position: SourcePosition) => void): InterpolatedToken | StructuralToken {
    const mode = this.modes[this.modes.length - 1];
    if (!mode || mode.mode === "field") throw new Error("interpolation text mode required");
    const owner = mode.mode === "literal" ? mode : mode.owner;
    const start = source.position;
    let content = "";
    const points: number[] = [];
    let warning: { message: string; position: SourcePosition } | undefined;
    const warn = (escape: string, position: SourcePosition, octal = false): void => {
      warning ??= { message: escapeWarning(escape, octal), position };
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
        return { kind: `${owner.flavor}-end`, text: source.text.slice(start.offset, source.position.offset), start, end: source.position };
      }
      if (character === "\n" && !owner.triple) throw source.error("unterminated interpolated string literal", owner.start);
      if (character === "{" || character === "}") {
        if (mode.mode === "literal" && source.peek(1) === character) {
          source.advance(); source.advance(); content += character; points.push(character.codePointAt(0)!);
          continue;
        }
        if (character === "}" && mode.mode === "literal") throw source.error("single '}' is not allowed in interpolated strings");
        if (source.position.offset !== start.offset) break;
        source.advance();
        if (character === "{") this.modes.push({ mode: "field", owner, depth, start });
        else this.modes.pop();
        return { kind: "operator", text: character, start, end: source.position };
      }
      const position = source.position;
      content += source.advance();
      if (character === "\\" && !source.done) {
        // Braces are never backslash-escaped in f/t strings. Named Unicode escapes
        // are the exception: their braces belong to the escape, not a field.
        const next = source.peek();
        if (next === "{" || next === "}") {
          points.push(92);
          if (!owner.raw) warn(next, position);
          continue;
        }
        if (owner.raw) { content += source.advance(); points.push(92, next.codePointAt(0)!); }
        else {
          const escapeStart = source.position.offset;
          points.push(...readEscape(source, false, position, warn));
          content += source.text.slice(escapeStart, source.position.offset).replaceAll("\r\n", "\n").replaceAll("\r", "\n");
        }
      } else points.push(character.codePointAt(0)!);
    }
    if (source.position.offset === start.offset) this.assertClosed(source);
    if (warning) onWarning?.(warning.message, warning.position);
    return {
      kind: `${owner.flavor}-middle`, text: source.text.slice(start.offset, source.position.offset),
      content, value: Uint32Array.from(points), start, end: source.position
    };
  }

  assertClosed(source: PythonSource): void {
    const mode = this.modes[this.modes.length - 1];
    if (mode) throw source.error(mode.mode === "literal" ? "unterminated interpolated string literal" : "expecting '}' in interpolated string", mode.start);
  }
}
