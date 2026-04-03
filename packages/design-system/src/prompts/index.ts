import chalk from "chalk";
import * as clack from "@clack/prompts";
import { resolveOutputFormat } from "../internal/output-format.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import { cancel, isCancel } from "./primitives/cancel.js";
import { intro } from "./primitives/intro.js";
import { log } from "./primitives/log.js";
import { note } from "./primitives/note.js";
import { outro } from "./primitives/outro.js";
import { spinner } from "./primitives/spinner.js";

export { isCancel, cancel, log };
export { intro, outro, note, spinner };

export function introPlain(title: string): void {
  const format = resolveOutputFormat();
  if (format === "markdown") {
    process.stdout.write(`# ${stripAnsi(title)}\n\n`);
    return;
  }
  if (format === "json") {
    return;
  }
  process.stdout.write(`${chalk.gray("┌")}  ${title}\n`);
}

export interface SelectOptions<Value> {
  message: string;
  options: Array<{ value: Value; label: string; hint?: string }>;
  initialValue?: Value;
}

export async function select<Value>(
  opts: SelectOptions<Value>
): Promise<Value | symbol> {
  return clack.select(opts as Parameters<typeof clack.select<Value>>[0]);
}

export type MultiselectOptions<Value> = Parameters<typeof clack.multiselect<Value>>[0];

/**
 * Prompts the user to select one or more values from a list.
 *
 * Returns the selected values as an array, or a cancellation symbol if the
 * user cancels. Use `isCancel` to check for cancellation.
 *
 * @example
 * const result = await multiselect({
 *   message: "Pick workflows to run",
 *   options: [{ label: "Fix Vulnerabilities", value: "fix-vulnerabilities" }],
 *   required: true
 * });
 * if (!isCancel(result)) {
 *   // result is Value[]
 * }
 */
export async function multiselect<Value>(
  opts: MultiselectOptions<Value>
): Promise<Value[] | symbol> {
  return clack.multiselect(opts);
}

export type TextOptions = Parameters<typeof clack.text>[0];

export async function text(opts: TextOptions): Promise<string | symbol> {
  return clack.text(opts as Parameters<typeof clack.text>[0]);
}

export interface ConfirmOptions {
  message: string;
  initialValue?: boolean;
}

export async function confirm(opts: ConfirmOptions): Promise<boolean | symbol> {
  return clack.confirm(opts as Parameters<typeof clack.confirm>[0]);
}

export class PromptCancelledError extends Error {
  constructor(message = "Operation cancelled.") {
    super(message);
    this.name = "PromptCancelledError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export async function confirmOrCancel(opts: ConfirmOptions): Promise<boolean> {
  const result = await confirm(opts);
  if (isCancel(result)) {
    cancel("Operation cancelled.");
    throw new PromptCancelledError();
  }
  return result === true;
}

export interface PasswordOptions {
  message: string;
  validate?: (value: string) => string | undefined;
}

export async function password(opts: PasswordOptions): Promise<string | symbol> {
  return clack.password(opts as Parameters<typeof clack.password>[0]);
}

export type SpinnerOptions = {
  start: (message?: string) => void;
  stop: (message?: string, code?: number) => void;
  message: (message?: string) => void;
};

export interface WithSpinnerOptions<T> {
  message: string;
  fn: () => Promise<T>;
  stopMessage?: (result: T) => string;
  subtext?: (result: T) => string | undefined;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export async function withSpinner<T>(options: WithSpinnerOptions<T>): Promise<T> {
  const { message, fn, stopMessage, subtext } = options;

  if (resolveOutputFormat() === "json") {
    const result = await fn();
    const sub = subtext ? subtext(result) : undefined;
    if (sub) {
      process.stdout.write(sub + "\n");
    }
    return result;
  }

  const noSpinner = process.env.POE_NO_SPINNER === "1";
  const isTTY = process.stdout.isTTY;

  if (noSpinner || !isTTY) {
    const result = await fn();
    const msg = stopMessage ? stopMessage(result) : undefined;
    if (msg) {
      process.stdout.write(`\x1b[32m◆\x1b[0m  ${msg}\n`);
    }
    const sub = subtext ? subtext(result) : undefined;
    if (sub) {
      for (const line of sub.split("\n")) {
        process.stdout.write(`\x1b[90m│\x1b[0m     ${line}\n`);
      }
    }
    return result;
  }

  const s = spinner();
  const start = Date.now();
  s.start(message);

  const timer = setInterval(() => {
    s.message(`${message} [${formatElapsed(Date.now() - start)}]`);
  }, 1000);

  try {
    const result = await fn();
    clearInterval(timer);
    const elapsed = formatElapsed(Date.now() - start);
    const msg = stopMessage ? stopMessage(result) : undefined;
    s.stop(msg ? `${msg} [${elapsed}]` : `Done [${elapsed}]`);

    const sub = subtext ? subtext(result) : undefined;
    if (sub) {
      for (const line of sub.split("\n")) {
        process.stdout.write(`\x1b[90m│\x1b[0m     ${line}\n`);
      }
    }

    return result;
  } catch (error) {
    clearInterval(timer);
    s.stop("", 1);
    throw error;
  }
}
