export type InterpreterDiagnostic = {
  kind: string;
  filename: string;
  line: number;
  column: number;
  message: string;
};

export function formatInterpreterError(source: string, error: InterpreterDiagnostic): string {
  const lines = splitLines(source);
  const excerpt = createExcerpt(lines, error.line);
  const lineNumberWidth = String(excerpt[excerpt.length - 1]?.number ?? Math.max(error.line, 1)).length;
  const reportedLine = excerpt.find((line) => line.number === Math.max(error.line, 1)) ?? excerpt[excerpt.length - 1];
  const caretPadding = createCaretPadding(reportedLine?.content ?? "", error.column, reportedLine?.hasSource === true);

  return [
    `${error.kind}: ${error.filename}:${error.line}:${error.column}`,
    "",
    ...excerpt.map((line) => `${String(line.number).padStart(lineNumberWidth)} | ${line.content}`),
    `${" ".repeat(lineNumberWidth)} | ${caretPadding}^`,
    "",
    error.message
  ].join("\n");
}

function createExcerpt(
  sourceLines: readonly string[],
  reportedLine: number
): Array<{ number: number; content: string; hasSource: boolean }> {
  const safeLineNumber = Math.max(reportedLine, 1);

  if (safeLineNumber > sourceLines.length) {
    return [
      {
        number: safeLineNumber,
        content: "",
        hasSource: false
      }
    ];
  }

  const excerpt: Array<{ number: number; content: string; hasSource: boolean }> = [];
  const startLine = Math.max(1, safeLineNumber - 2);
  const endLine = Math.min(sourceLines.length, safeLineNumber + 1);

  for (let line = startLine; line <= endLine; line += 1) {
    excerpt.push({
      number: line,
      content: sourceLines[line - 1] ?? "",
      hasSource: true
    });
  }

  return excerpt;
}

function splitLines(source: string): string[] {
  return source.split(/\r\n|\n|\r/);
}

function createCaretPadding(line: string, column: number, hasSource: boolean): string {
  let padding = "";
  const maxColumn = hasSource ? Math.max(Math.min(column - 1, line.length), 0) : Math.max(column - 1, 0);

  for (const character of line.slice(0, maxColumn)) {
    padding += character === "\t" ? "\t" : " ";
  }

  if (maxColumn > line.length) {
    padding += " ".repeat(maxColumn - line.length);
  }

  return padding;
}
