import chalk from "chalk";
import { symbols } from "../../components/symbols.js";
import { resolveOutputFormat } from "../../internal/output-format.js";
import { stripAnsi } from "../../internal/strip-ansi.js";

export interface LogMessageOptions {
  symbol?: string;
}

function writeTerminalMessage(
  msg: string,
  { symbol = chalk.gray("│") }: LogMessageOptions = {}
): void {
  const lines = msg.split("\n");
  const [firstLine = "", ...continuationLines] = lines;
  const output = [
    `${symbol}  ${firstLine}`,
    ...continuationLines.map((line) => `${chalk.gray("│")}  ${line}`)
  ].join("\n");

  process.stdout.write(`${output}\n`);
}

export function message(msg: string, options?: LogMessageOptions): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`- ${stripAnsi(msg)}\n`);
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
  message(msg, { symbol: symbols.info });
}

export function warn(msg: string): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`- **warning:** ${msg}\n`);
    return;
  }
  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ level: "warn", message: msg })}\n`);
    return;
  }

  process.stdout.write(`${chalk.yellow("▲")}  ${msg}\n`);
}

export function error(msg: string): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`- **error:** ${msg}\n`);
    return;
  }
  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({ level: "error", message: msg })}\n`
    );
    return;
  }

  process.stdout.write(`${chalk.red("✕")}  ${msg}\n`);
}

export const log = {
  info,
  message,
  warn,
  error
};
