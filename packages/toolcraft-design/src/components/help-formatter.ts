import { resolveOutputFormat } from "../internal/output-format.js";
import { typography } from "../tokens/typography.js";
import { text } from "./text.js";

export type HelpTokenRole = "command" | "argument" | "option" | "literal" | "dim";

export interface HelpToken {
  text: string;
  role: HelpTokenRole;
}

export interface CommandInfo {
  name: string;
  /** Structured tokens for TTY/markdown styling. Plain `name` is used when absent. */
  nameTokens?: HelpToken[];
  description: string;
  /** Nesting depth relative to the help target. Depth 0 is a direct child. */
  depth?: number;
}

export interface OptionInfo {
  flags: string;
  /** Structured tokens for TTY/markdown styling. Plain `flags` is used when absent. */
  flagTokens?: HelpToken[];
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

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function normalizeInline(value: string): string {
  return value.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ");
}

function readControlSequence(value: string, index: number): number | undefined {
  if (value[index] !== "\u001b") {
    return undefined;
  }

  if (value[index + 1] === "[") {
    let nextIndex = index + 2;
    while (nextIndex < value.length) {
      const code = value.charCodeAt(nextIndex);
      nextIndex += 1;
      if (code >= 0x40 && code <= 0x7e) {
        return nextIndex;
      }
    }
    return value.length;
  }

  if (value[index + 1] === "]") {
    let nextIndex = index + 2;
    while (nextIndex < value.length) {
      if (value[nextIndex] === "\u0007") {
        return nextIndex + 1;
      }
      if (value[nextIndex] === "\u001b" && value[nextIndex + 1] === "\\") {
        return nextIndex + 2;
      }
      nextIndex += 1;
    }
    return value.length;
  }

  return index + 1;
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function clusterWidth(cluster: string): number {
  const codePoints = Array.from(cluster).map((char) => char.codePointAt(0) ?? 0);
  if (codePoints.some((codePoint) => codePoint === 0x200d || (codePoint >= 0xfe00 && codePoint <= 0xfe0f))) {
    return 2;
  }

  return codePoints.reduce((width, codePoint) => {
    if (codePoint === 0 || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
      return width;
    }
    return width + (isWideCodePoint(codePoint) ? 2 : 1);
  }, 0);
}

function visibleWidth(value: string): number {
  let width = 0;
  let index = 0;

  while (index < value.length) {
    const nextIndex = readControlSequence(value, index);
    if (nextIndex !== undefined) {
      index = nextIndex;
      continue;
    }

    const segment = graphemeSegmenter.segment(value.slice(index))[Symbol.iterator]().next().value as
      | Intl.SegmentData
      | undefined;
    const cluster = segment?.segment ?? "";
    width += clusterWidth(cluster);
    index += cluster.length || 1;
  }

  return width;
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

function leadingWhitespaceWidth(value: string): { prefix: string; rest: string } {
  let index = 0;
  while (index < value.length && isWhitespace(value[index])) {
    index += 1;
  }
  return { prefix: value.slice(0, index), rest: value.slice(index) };
}

function takeVisiblePrefix(value: string, width: number): { prefix: string; rest: string } {
  let visible = 0;
  let index = 0;

  while (index < value.length) {
    const controlEnd = readControlSequence(value, index);
    if (controlEnd !== undefined) {
      index = controlEnd;
      continue;
    }

    const segment = graphemeSegmenter.segment(value.slice(index))[Symbol.iterator]().next().value as
      | Intl.SegmentData
      | undefined;
    const cluster = segment?.segment ?? value[index] ?? "";
    const nextWidth = clusterWidth(cluster);
    if (visible > 0 && visible + nextWidth > width) {
      break;
    }
    visible += nextWidth;
    index += cluster.length || 1;
  }

  return { prefix: value.slice(0, index), rest: value.slice(index) };
}

function wrapWords(value: string, width: number, continuationWidth = width): string[] {
  // Preserve leading whitespace only on the first wrapped line so hang-indented
  // left cells (command depth prefixes) do not re-indent every continuation.
  const { prefix, rest } = leadingWhitespaceWidth(value);
  const prefixWidth = visibleWidth(prefix);
  const firstContentWidth = Math.max(1, width - prefixWidth);
  const words = splitWords(rest);
  if (words.length === 0) {
    return [prefix];
  }

  const lines: string[] = [];
  let line = "";
  let isFirstLine = true;

  for (const word of words) {
    const limit = isFirstLine ? firstContentWidth : continuationWidth;
    if (line && visibleWidth(line) + 1 + visibleWidth(word) <= limit) {
      line += ` ${word}`;
      continue;
    }
    if (line) {
      lines.push(isFirstLine ? `${prefix}${line}` : line);
      isFirstLine = false;
      line = "";
    }

    let remaining = word;
    while (visibleWidth(remaining) > (isFirstLine ? firstContentWidth : continuationWidth)) {
      const chunk = takeVisiblePrefix(
        remaining,
        isFirstLine ? firstContentWidth : continuationWidth
      );
      lines.push(isFirstLine ? `${prefix}${chunk.prefix}` : chunk.prefix);
      isFirstLine = false;
      remaining = chunk.rest;
    }
    line = remaining;
  }

  lines.push(isFirstLine ? `${prefix}${line}` : line);
  return lines;
}

function validateLayoutValue(value: number, name: keyof Omit<FormatColumnsOptions, "rows">): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number.`);
  }
}

export function formatColumns(opts: FormatColumnsOptions): string {
  const rows = opts.rows.map((row) => ({
    left: normalizeInline(row.left),
    right: row.right
  }));
  if (rows.length === 0) {
    return "";
  }

  const totalWidth = opts.totalWidth ?? process.stdout.columns ?? 100;
  const minLeftWidth = opts.minLeftWidth ?? 12;
  const maxLeftWidth = opts.maxLeftWidth ?? 32;
  const gap = opts.gap ?? 3;
  const indent = opts.indent ?? 2;
  validateLayoutValue(totalWidth, "totalWidth");
  validateLayoutValue(minLeftWidth, "minLeftWidth");
  validateLayoutValue(maxLeftWidth, "maxLeftWidth");
  validateLayoutValue(gap, "gap");
  validateLayoutValue(indent, "indent");
  const maxLeftContentWidth = Math.max(...rows.map((row) => visibleWidth(row.left)));
  const leftWidth = clamp(maxLeftContentWidth + gap, minLeftWidth, maxLeftWidth);
  const rightWidth = Math.max(1, totalWidth - leftWidth - indent);
  const leftWrapWidth = Math.max(1, totalWidth - indent);
  const firstIndent = " ".repeat(indent);
  const continuationIndent = " ".repeat(indent + leftWidth);

  return rows
    .flatMap((row) => {
      const leftLeading = leadingWhitespaceWidth(row.left).prefix;
      // Continuations hang under the left cell start (including depth prefix) by +2.
      const leftHangIndent = " ".repeat(indent + visibleWidth(leftLeading) + 2);
      const leftLines = wrapWords(
        row.left,
        leftWrapWidth,
        Math.max(1, totalWidth - visibleWidth(leftHangIndent))
      );

      if (row.right.length === 0) {
        return leftLines.map((line, index) =>
          index === 0 ? `${firstIndent}${line}` : `${leftHangIndent}${line}`
        );
      }

      const rightLines = wrapWords(row.right, rightWidth);
      const leftFitsInColumn = visibleWidth(row.left) < leftWidth;

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

export function styleHelpToken(token: HelpToken): string {
  switch (token.role) {
    case "command":
      return text.command(token.text);
    case "argument":
      return styleArgumentToken(token.text);
    case "option":
      return text.option(token.text);
    case "dim":
      return styleDim(token.text);
    case "literal":
      return token.text;
  }
}

function styleArgumentToken(content: string): string {
  // Token text already includes angle brackets. text.argument re-wraps in markdown,
  // so strip first there; terminal/json keep the full `<value>` form.
  const format = resolveOutputFormat();
  if (format === "markdown" && content.startsWith("<") && content.endsWith(">")) {
    return text.argument(content.slice(1, -1));
  }
  if (format === "json") {
    return content;
  }
  return text.argument(content);
}

function styleDim(content: string): string {
  // Structural brackets stay unstyled in markdown/json; italicizing them as muted is wrong.
  const format = resolveOutputFormat();
  if (format === "json" || format === "markdown") {
    return content;
  }
  return typography.dim(content);
}

export function joinHelpTokens(tokens: HelpToken[]): string {
  return tokens.map((token) => token.text).join("");
}

export function renderHelpTokens(tokens: HelpToken[]): string {
  return tokens.map((token) => styleHelpToken(token)).join("");
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
    rows: commands.map((cmd) => {
      const depthPrefix = " ".repeat((cmd.depth ?? 0) * 2);
      const styledName =
        cmd.nameTokens !== undefined && cmd.nameTokens.length > 0
          ? renderHelpTokens(cmd.nameTokens)
          : text.command(cmd.name);
      return {
        left: `${depthPrefix}${styledName}`,
        right: cmd.description
      };
    })
  });
}

export function formatOptionList(options: OptionInfo[]): string {
  return formatColumns({
    rows: options.map((opt) => ({
      left:
        opt.flagTokens !== undefined && opt.flagTokens.length > 0
          ? renderHelpTokens(opt.flagTokens)
          : text.option(opt.flags),
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
  formatOptionList,
  styleHelpToken,
  joinHelpTokens,
  renderHelpTokens
} as const;
