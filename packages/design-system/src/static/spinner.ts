import chalk from "chalk";
import { symbols } from "../components/symbols.js";
import { resolveOutputFormat } from "../internal/output-format.js";

export const SPINNER_FRAMES = ["◒", "◐", "◓", "◑"] as const;

export interface SpinnerFrameOptions {
  frame?: number;
  message: string;
  timer?: string;
}

export function renderSpinnerFrame(options: SpinnerFrameOptions): string {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    return `- ${options.message}${options.timer ? ` [${options.timer}]` : ""}...\n`;
  }

  if (format === "json") {
    return `${JSON.stringify({
      type: "spinner",
      state: "running",
      message: options.message,
      ...(options.timer ? { timer: options.timer } : {})
    })}\n`;
  }

  const frame = options.frame ?? 0;
  const spinnerChar = chalk.magenta(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
  const timerSuffix = options.timer ? chalk.dim(` [${options.timer}]`) : "";
  const bar = chalk.gray(symbols.bar);

  return `${spinnerChar}  ${options.message}${timerSuffix}\n${bar}`;
}

export interface SpinnerStoppedOptions {
  message: string;
  code?: number;
  timer?: string;
  subtext?: string;
}

export function renderSpinnerStopped(options: SpinnerStoppedOptions): string {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    return `- ${options.message}${options.timer ? ` [${options.timer}]` : ""}\n`;
  }

  if (format === "json") {
    return `${JSON.stringify({
      type: "spinner",
      state: "stopped",
      message: options.message,
      ...(options.timer ? { timer: options.timer } : {})
    })}\n`;
  }

  const code = options.code ?? 0;
  const symbol = code === 0 ? chalk.green("◆") : chalk.red("■");
  const timerSuffix = options.timer ? chalk.dim(` [${options.timer}]`) : "";
  const bar = chalk.gray(symbols.bar);

  let output = `${symbol}  ${options.message}${timerSuffix}`;
  if (options.subtext) {
    output += `\n${bar}     ${chalk.dim(options.subtext)}`;
  }
  return output;
}
