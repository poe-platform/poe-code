import { text } from "toolcraft-design";

export interface SourceSnippetOptions {
  source: string;
  line: number;
  column?: number;
  context?: number;
  filePath?: string;
}

export function renderSourceSnippet(opts: SourceSnippetOptions): string {
  const lines = opts.source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const line = clampInteger(opts.line, 1, Math.max(lines.length, 1));
  const context = Math.max(0, Math.floor(opts.context ?? 2));
  const startLine = Math.max(1, line - context);
  const endLine = Math.min(lines.length, line + context);
  const gutterWidth = String(endLine).length;
  const output: string[] = [];

  if (opts.filePath !== undefined) {
    output.push(
      muted(
        `--> ${opts.filePath}:${line}${opts.column === undefined ? "" : `:${Math.max(1, opts.column)}`}`
      )
    );
  }

  output.push(renderDivider(gutterWidth));

  for (let currentLine = startLine; currentLine <= endLine; currentLine += 1) {
    const sourceLine = lines[currentLine - 1] ?? "";
    output.push(`${muted(String(currentLine).padStart(gutterWidth, " "))} | ${sourceLine}`);

    if (currentLine === line && opts.column !== undefined) {
      const column = Math.max(1, Math.floor(opts.column));
      output.push(`${muted(" ".repeat(gutterWidth))} | ${" ".repeat(column - 1)}${error("^")}`);
    }
  }

  output.push(renderDivider(gutterWidth));

  return output.join("\n");
}

function renderDivider(gutterWidth: number): string {
  return `${muted(" ".repeat(gutterWidth))} |`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function muted(value: string): string {
  return shouldStyleStderr() ? text.muted(value) : value;
}

function error(value: string): string {
  return shouldStyleStderr() ? text.error(value) : value;
}

function shouldStyleStderr(): boolean {
  return process.stderr.isTTY === true;
}
