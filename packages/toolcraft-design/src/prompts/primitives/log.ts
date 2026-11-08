import { color } from "../../components/color.js";
import { symbols } from "../../components/symbols.js";
import { resolveOutputFormat } from "../../internal/output-format.js";
import { stripAnsi } from "../../internal/strip-ansi.js";

export interface LogMessageOptions {
  symbol?: string;
  secondarySymbol?: string;
  spacing?: number;
  withGuide?: boolean;
}

function renderMarkdownInline(value: string): string {
  return stripAnsi(value).replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ");
}

function writeTerminalMessage(
  msg: string,
  {
    symbol = color.gray("│"),
    secondarySymbol = color.gray("│"),
    spacing = 1,
    withGuide = true
  }: LogMessageOptions = {}
): void {
  const lines: string[] = [];
  const showGuide = withGuide !== false;
  const contentLines = msg.split("\n");
  const prefix = showGuide ? `${symbol}  ` : "";
  const continuationPrefix = showGuide ? `${secondarySymbol}  ` : "";
  const emptyGuide = showGuide ? secondarySymbol : "";

  for (let index = 0; index < spacing; index += 1) {
    lines.push(emptyGuide);
  }

  if (contentLines.length === 0) {
    process.stdout.write("\n");
    return;
  }

  const [firstLine = "", ...continuationLines] = contentLines;
  if (firstLine.length > 0) {
    lines.push(`${prefix}${firstLine}`);
  } else {
    lines.push(showGuide ? symbol : "");
  }

  for (const line of continuationLines) {
    if (line.length > 0) {
      lines.push(`${continuationPrefix}${line}`);
      continue;
    }
    lines.push(emptyGuide);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

export function message(msg: string, options?: LogMessageOptions): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`- ${renderMarkdownInline(msg)}\n`);
    return;
  }
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ level: "message", message: stripAnsi(msg) })}\n`
    );
    return;
  }

  writeTerminalMessage(msg, options);
}

export function info(msg: string): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`- **info:** ${renderMarkdownInline(msg)}\n`);
    return;
  }
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ level: "info", message: stripAnsi(msg) })}\n`
    );
    return;
  }

  message(msg, { symbol: symbols.info });
}

export function success(msg: string): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`- **success:** ${renderMarkdownInline(msg)}\n`);
    return;
  }
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ level: "success", message: stripAnsi(msg) })}\n`
    );
    return;
  }

  message(msg, { symbol: symbols.success });
}

export function warn(msg: string): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`- **warning:** ${renderMarkdownInline(msg)}\n`);
    return;
  }
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ level: "warn", message: stripAnsi(msg) })}\n`
    );
    return;
  }

  message(msg, { symbol: color.yellow("▲") });
}

export function error(msg: string): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`- **error:** ${renderMarkdownInline(msg)}\n`);
    return;
  }
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ level: "error", message: stripAnsi(msg) })}\n`
    );
    return;
  }

  message(msg, { symbol: color.red("■") });
}

export const log = {
  info,
  success,
  message,
  warn,
  error
};
