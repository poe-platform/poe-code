import type {
  CommandInfo,
  FormatColumnsOptions,
  OptionInfo
} from "./help-formatter.js";
import { joinHelpTokens } from "./help-formatter.js";

export function stripAnsi(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\u001b") {
      if (value[index + 1] === "[") {
        index += 2;
        while (index < value.length) {
          const code = value.charCodeAt(index);
          if (code >= 0x40 && code <= 0x7e) {
            break;
          }
          index += 1;
        }
      }
      continue;
    }

    output += value[index];
  }
  return output;
}

function toAscii(value: string): string {
  let output = "";
  const stripped = stripAnsi(value);
  for (let index = 0; index < stripped.length; index += 1) {
    const code = stripped.charCodeAt(index);
    output += code <= 0x7f ? stripped[index] : "?";
  }
  return output;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function padEndVisible(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - value.length));
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

function leadingWhitespace(value: string): { prefix: string; rest: string } {
  let index = 0;
  while (index < value.length && isWhitespace(value[index])) {
    index += 1;
  }
  return { prefix: value.slice(0, index), rest: value.slice(index) };
}

function takePrefix(value: string, width: number): { prefix: string; rest: string } {
  return { prefix: value.slice(0, width), rest: value.slice(width) };
}

function wrapWords(value: string, width: number, continuationWidth = width): string[] {
  // Preserve leading whitespace only on the first wrapped line so hang-indented
  // left cells (command depth prefixes) do not re-indent every continuation.
  const { prefix, rest } = leadingWhitespace(value);
  const firstContentWidth = Math.max(1, width - prefix.length);
  const words = splitWords(rest);
  if (words.length === 0) {
    return [prefix];
  }

  const lines: string[] = [];
  let line = "";
  let isFirstLine = true;

  for (const word of words) {
    const limit = isFirstLine ? firstContentWidth : continuationWidth;
    if (line && line.length + 1 + word.length <= limit) {
      line += ` ${word}`;
      continue;
    }
    if (line) {
      lines.push(isFirstLine ? `${prefix}${line}` : line);
      isFirstLine = false;
      line = "";
    }

    let remaining = word;
    while (remaining.length > (isFirstLine ? firstContentWidth : continuationWidth)) {
      const chunk = takePrefix(remaining, isFirstLine ? firstContentWidth : continuationWidth);
      lines.push(isFirstLine ? `${prefix}${chunk.prefix}` : chunk.prefix);
      isFirstLine = false;
      remaining = chunk.rest;
    }
    line = remaining;
  }

  lines.push(isFirstLine ? `${prefix}${line}` : line);
  return lines;
}

export function formatColumns(opts: FormatColumnsOptions): string {
  const rows = opts.rows.map((row) => ({
    left: toAscii(row.left),
    right: toAscii(row.right)
  }));

  if (rows.length === 0) {
    return "";
  }

  const totalWidth = opts.totalWidth ?? process.stdout.columns ?? 100;
  const minLeftWidth = opts.minLeftWidth ?? 12;
  const maxLeftWidth = opts.maxLeftWidth ?? 32;
  const gap = opts.gap ?? 3;
  const indent = opts.indent ?? 2;
  const maxLeftContentWidth = Math.max(...rows.map((row) => row.left.length));
  const leftWidth = clamp(maxLeftContentWidth + gap, minLeftWidth, maxLeftWidth);
  const rightWidth = Math.max(1, totalWidth - leftWidth - indent);
  const leftWrapWidth = Math.max(1, totalWidth - indent);
  const firstIndent = " ".repeat(indent);
  const continuationIndent = " ".repeat(indent + leftWidth);

  return rows
    .flatMap((row) => {
      let leftLeadingWidth = 0;
      while (leftLeadingWidth < row.left.length && isWhitespace(row.left[leftLeadingWidth])) {
        leftLeadingWidth += 1;
      }
      // Continuations hang under the left cell start (including depth prefix) by +2.
      const leftHangIndent = " ".repeat(indent + leftLeadingWidth + 2);
      const leftLines = wrapWords(
        row.left,
        leftWrapWidth,
        Math.max(1, totalWidth - leftHangIndent.length)
      );

      if (row.right.length === 0) {
        return leftLines.map((line, index) =>
          index === 0 ? `${firstIndent}${line}` : `${leftHangIndent}${line}`
        );
      }

      const rightLines = wrapWords(row.right, rightWidth);
      const leftFitsInColumn = row.left.length < leftWidth;

      if (leftFitsInColumn && leftLines.length === 1) {
        const firstLine = `${firstIndent}${padEndVisible(leftLines[0] ?? "", leftWidth)}${rightLines[0]}`;
        const continuationLines = rightLines
          .slice(1)
          .map((line) => `${continuationIndent}${line}`);
        return [firstLine, ...continuationLines];
      }

      const renderedLeft = leftLines.map((line, index) =>
        index === 0 ? `${firstIndent}${line}` : `${leftHangIndent}${line}`
      );
      const renderedRight = rightLines.map((line) => `${continuationIndent}${line}`);
      return [...renderedLeft, ...renderedRight];
    })
    .join("\n");
}

export function formatCommandList(commands: CommandInfo[]): string {
  return formatColumns({
    rows: commands.map((cmd) => ({
      left: `${" ".repeat((cmd.depth ?? 0) * 2)}${
        cmd.nameTokens !== undefined && cmd.nameTokens.length > 0
          ? joinHelpTokens(cmd.nameTokens)
          : cmd.name
      }`,
      right: cmd.description
    }))
  });
}

export function formatOptionList(options: OptionInfo[]): string {
  return formatColumns({
    rows: options.map((opt) => ({
      left:
        opt.flagTokens !== undefined && opt.flagTokens.length > 0
          ? joinHelpTokens(opt.flagTokens)
          : opt.flags,
      right: opt.description
    }))
  });
}
