import { color } from "../components/color.js";
import { symbols } from "../components/symbols.js";
import { resolveOutputFormat } from "../internal/output-format.js";

export const SPINNER_FRAMES = Object.freeze(["◒", "◐", "◓", "◑"] as const);

export interface SpinnerFrameOptions {
  frame?: number;
  message: string;
  timer?: string;
}

export function renderSpinnerFrame(options: SpinnerFrameOptions): string {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    return `- ${renderMarkdownInline(options.message)}${options.timer ? ` [${renderMarkdownInline(options.timer)}]` : ""}...\n`;
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
  const index = ((frame % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) % SPINNER_FRAMES.length;
  const spinnerChar = color.magenta(SPINNER_FRAMES[index]);
  const timerSuffix = options.timer ? color.dim(` [${options.timer}]`) : "";
  const bar = color.gray(symbols.bar);

  return `${spinnerChar}  ${options.message}${timerSuffix}\n${bar}`;
}

export interface SpinnerStoppedOptions {
  message: string;
  code?: number;
  timer?: string;
  subtext?: string;
}

function renderMarkdownInline(value: string): string {
  return value.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ");
}

export function renderSpinnerStopped(options: SpinnerStoppedOptions): string {
  const format = resolveOutputFormat();

  if (format === "markdown") {
    return `- ${renderMarkdownInline(options.message)}${options.timer ? ` [${renderMarkdownInline(options.timer)}]` : ""}\n`;
  }

  if (format === "json") {
    return `${JSON.stringify({
      type: "spinner",
      state: "stopped",
      message: options.message,
      code: options.code ?? 0,
      ...(options.timer ? { timer: options.timer } : {}),
      ...(options.subtext ? { subtext: options.subtext } : {})
    })}\n`;
  }

  const code = options.code ?? 0;
  const symbol = code === 0 ? color.green("◆") : color.red("■");
  const timerSuffix = options.timer ? color.dim(` [${options.timer}]`) : "";
  const bar = color.gray(symbols.bar);

  let output = `${symbol}  ${options.message}${timerSuffix}`;
  if (options.subtext) {
    output += `\n${bar}     ${color.dim(options.subtext)}`;
  }
  return output;
}
