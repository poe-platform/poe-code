export type ParseDiagnostic = {
  kind: "ParseError";
  filename: string;
  line: number;
  column: number;
  excerpt: string;
  caret: string;
  message: string;
};

export class ParseError extends Error implements ParseDiagnostic {
  readonly kind = "ParseError";
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
  readonly caret: string;

  constructor(
    readonly filename: string,
    message: string,
    line: number,
    column: number,
    excerpt: string,
    caret: string
  ) {
    super(message);
    this.name = "ParseError";
    this.line = line;
    this.column = column;
    this.excerpt = excerpt;
    this.caret = caret;
  }
}

export function formatParseError(source: string, filename: string, error: Error): ParseError {
  const location = parseErrorLocation(error.message);
  if (location === undefined) {
    throw error;
  }

  const lines = splitLines(source);
  const startLine = Math.max(1, location.line - 2);
  const endLine = Math.min(lines.length, location.line + 1);
  const lineNumberWidth = String(endLine).length;
  const excerpt: string[] = [];

  for (let line = startLine; line <= endLine; line += 1) {
    excerpt.push(`${String(line).padStart(lineNumberWidth)} | ${lines[line - 1] ?? ""}`);
  }

  const caretPadding = createCaretPadding(lines[location.line - 1] ?? "", location.column);
  const caret = `${" ".repeat(lineNumberWidth)} | ${caretPadding}^`;
  return new ParseError(filename, error.message, location.line, location.column, excerpt.join("\n"), caret);
}

function parseErrorLocation(message: string): { line: number; column: number } | undefined {
  const linePrefix = " at line ";
  const columnPrefix = ", column ";
  const lineIndex = message.lastIndexOf(linePrefix);
  if (lineIndex === -1) {
    return undefined;
  }

  const columnIndex = message.indexOf(columnPrefix, lineIndex + linePrefix.length);
  if (columnIndex === -1) {
    return undefined;
  }

  const line = Number(message.slice(lineIndex + linePrefix.length, columnIndex));
  const columnStart = columnIndex + columnPrefix.length;
  const columnEnd = message.endsWith(".") ? message.length - 1 : message.length;
  const column = Number(message.slice(columnStart, columnEnd));
  if (!Number.isInteger(line) || !Number.isInteger(column)) {
    return undefined;
  }

  return { line, column };
}

function splitLines(source: string): string[] {
  return source.split(/\r\n|\n|\r/);
}

function createCaretPadding(line: string, column: number): string {
  let padding = "";

  for (const character of line.slice(0, Math.max(column - 1, 0))) {
    padding += character === "\t" ? "\t" : " ";
  }

  return padding;
}
