import { text } from "./text.js";

export interface CommandInfo {
  name: string;
  description: string;
}

export interface OptionInfo {
  flags: string;
  description: string;
}

export interface FormatColumnsOptions {
  rows: Array<{ left: string; right: string }>;
  totalWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  gap?: number;
  indent?: number;
}

function stripAnsi(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1)
    if (value[index] === "\u001b" && value[index + 1] === "[")
      while (index < value.length && value[index] !== "m") index += 1;
    else output += value[index];
  return output;
}

function visibleWidth(value: string): number {
  return stripAnsi(value).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function padEndVisible(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleWidth(value)));
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r";
}

function splitWords(value: string): string[] {
  const words: string[] = [];
  let word = "";

  for (const char of value) {
    if (isWhitespace(char)) {
      if (word) {
        words.push(word);
        word = "";
      }
      continue;
    }
    word += char;
  }

  if (word) {
    words.push(word);
  }

  return words;
}

function wrapWords(value: string, width: number): string[] {
  const words = splitWords(value);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }

    if (visibleWidth(line) + 1 + visibleWidth(word) <= width) {
      line += ` ${word}`;
      continue;
    }

    lines.push(line);
    line = word;
  }

  lines.push(line);
  return lines;
}

export function formatColumns(opts: FormatColumnsOptions): string {
  const { rows } = opts;
  if (rows.length === 0) {
    return "";
  }

  const totalWidth = opts.totalWidth ?? process.stdout.columns ?? 100;
  const minLeftWidth = opts.minLeftWidth ?? 12;
  const maxLeftWidth = opts.maxLeftWidth ?? 32;
  const gap = opts.gap ?? 3;
  const indent = opts.indent ?? 2;
  const maxLeftContentWidth = Math.max(...rows.map((row) => visibleWidth(row.left)));
  const leftWidth = clamp(maxLeftContentWidth + gap, minLeftWidth, maxLeftWidth);
  const rightWidth = Math.max(20, totalWidth - leftWidth - indent);
  const firstIndent = " ".repeat(indent);
  const continuationIndent = " ".repeat(indent + leftWidth);

  return rows
    .flatMap((row) => {
      const rightLines = wrapWords(row.right, rightWidth);
      const firstLine = `${firstIndent}${padEndVisible(row.left, leftWidth)}${rightLines[0]}`;
      const continuationLines = rightLines
        .slice(1)
        .map((line) => `${continuationIndent}${line}`);
      return [firstLine, ...continuationLines];
    })
    .join("\n");
}

export function formatCommand(name: string, description: string): string {
  return formatColumns({
    rows: [{ left: text.command(name), right: description }]
  });
}

export function formatUsage(command: string, args?: string): string {
  const argsStr = args ? ` ${text.argument(args)}` : "";
  return `${text.usageCommand(command)}${argsStr}`;
}

export function formatOption(flags: string, description: string): string {
  return formatColumns({
    rows: [{ left: text.option(flags), right: description }]
  });
}

export function formatCommandList(commands: CommandInfo[]): string {
  return formatColumns({
    rows: commands.map((cmd) => ({
      left: text.command(cmd.name),
      right: cmd.description
    }))
  });
}

export function formatOptionList(options: OptionInfo[]): string {
  return formatColumns({
    rows: options.map((opt) => ({
      left: text.option(opt.flags),
      right: opt.description
    }))
  });
}

export const helpFormatter = {
  formatColumns,
  formatCommand,
  formatUsage,
  formatOption,
  formatCommandList,
  formatOptionList
} as const;
