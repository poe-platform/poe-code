import chalk from "chalk";
import { symbols } from "../components/symbols.js";

export const SPINNER_FRAMES = ["◒", "◐", "◓", "◑"] as const;

export interface SpinnerFrameOptions {
  frame?: number;
  message: string;
  timer?: string;
}

export function renderSpinnerFrame(options: SpinnerFrameOptions): string {
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
  const code = options.code ?? 0;
  const symbol = code === 0
    ? chalk.green("◆")
    : chalk.red("■");
  const timerSuffix = options.timer ? chalk.dim(` [${options.timer}]`) : "";
  const bar = chalk.gray(symbols.bar);

  let output = `${symbol}  ${options.message}${timerSuffix}`;
  if (options.subtext) {
    output += `\n${bar}     ${chalk.dim(options.subtext)}`;
  }
  return output;
}
