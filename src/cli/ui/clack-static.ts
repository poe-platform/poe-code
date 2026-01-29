/**
 * Static rendering utilities for @clack/prompts components.
 * Useful for screenshots and non-interactive contexts.
 *
 * These values are extracted from @clack/prompts source.
 */
import chalk from "chalk";

/** Spinner animation frames from @clack/prompts */
export const SPINNER_FRAMES = ["◒", "◐", "◓", "◑"] as const;

/** Clack UI symbols */
export const CLACK_SYMBOLS = {
  /** Bar connector */
  bar: "│",
  /** Corner connectors */
  cornerTopRight: "╮",
  cornerBottomRight: "╯",
  /** Success indicator (green) */
  success: "◆",
  /** Error indicator (red) */
  error: "■",
  /** Warning indicator */
  warning: "▲",
  /** Info indicator */
  info: "●",
  /** Resolved/completed indicator */
  resolved: "◇",
  /** Active/selected indicator */
  active: "◆",
  /** Inactive indicator */
  inactive: "○"
} as const;

export interface SpinnerFrameOptions {
  /** Frame index (0-3) */
  frame?: number;
  /** Message to display */
  message: string;
  /** Show timer suffix (e.g., "[1s]") */
  timer?: string;
}

/**
 * Render a static spinner frame for screenshots.
 * Mimics @clack/prompts spinner appearance.
 */
export function renderSpinnerFrame(options: SpinnerFrameOptions): string {
  const frame = options.frame ?? 0;
  const spinnerChar = chalk.magenta(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
  const timerSuffix = options.timer ? chalk.dim(` [${options.timer}]`) : "";
  const bar = chalk.gray(CLACK_SYMBOLS.bar);

  return `${spinnerChar}  ${options.message}${timerSuffix}\n${bar}`;
}

export interface SpinnerStoppedOptions {
  /** Message to display */
  message: string;
  /** Exit code: 0 = success, 1 = error */
  code?: number;
  /** Timer value to display */
  timer?: string;
  /** Optional subtext displayed below the message */
  subtext?: string;
}

/**
 * Render a stopped spinner state for screenshots.
 */
export function renderSpinnerStopped(options: SpinnerStoppedOptions): string {
  const code = options.code ?? 0;
  const symbol = code === 0
    ? chalk.green(CLACK_SYMBOLS.success)
    : chalk.red(CLACK_SYMBOLS.error);
  const timerSuffix = options.timer ? chalk.dim(` [${options.timer}]`) : "";
  const bar = chalk.gray(CLACK_SYMBOLS.bar);

  let output = `${symbol}  ${options.message}${timerSuffix}`;
  if (options.subtext) {
    output += `\n${bar}     ${chalk.dim(options.subtext)}`;
  }
  return output;
}
