import { color } from "../components/color.js";
import { resolveOutputFormat } from "../internal/output-format.js";
import { stripAnsi } from "../internal/strip-ansi.js";
import type { CANCEL } from "./interactive/cancel-symbol.js";
import { confirmPrompt } from "./interactive/confirm.js";
import { multiselectPrompt } from "./interactive/multiselect.js";
import { passwordPrompt } from "./interactive/password.js";
import { selectPrompt, type SelectOption } from "./interactive/select.js";
import { textPrompt } from "./interactive/text.js";
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
  process.stdout.write(`${color.gray("┌")}  ${title}\n`);
}

export interface SelectOptions<Value> {
  message: string;
  options: Array<SelectOption<Value>>;
  initialValue?: Value;
  maxItems?: number;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function select<Value>(opts: SelectOptions<Value>): Promise<Value | typeof CANCEL> {
  return selectPrompt(opts);
}

export interface MultiselectOptions<Value> {
  message: string;
  options: Array<SelectOption<Value>>;
  initialValues?: Value[];
  required?: boolean;
  maxItems?: number;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

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
): Promise<Value[] | typeof CANCEL> {
  return multiselectPrompt(opts);
}

export interface TextOptions {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  validate?: (value: string) => string | Error | undefined;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function text(opts: TextOptions): Promise<string | typeof CANCEL> {
  return textPrompt(opts);
}

export interface ConfirmOptions {
  message: string;
  initialValue?: boolean;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function confirm(opts: ConfirmOptions): Promise<boolean | typeof CANCEL> {
  return confirmPrompt(opts);
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
  validate?: (value: string) => string | Error | undefined;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

export async function password(opts: PasswordOptions): Promise<string | typeof CANCEL> {
  return passwordPrompt(opts);
}

export type SpinnerOptions = {
  start: (message?: string) => void;
  stop: (message?: string, code?: number) => void;
  message: (message?: string) => void;
};

export interface WithSpinnerOptions<T> {
  message: string | (() => string);
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
  const readMessage = () => (typeof message === "function" ? message() : message);

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
      process.stdout.write(`${color.green("◆")}  ${msg}\n`);
    }
    const sub = subtext ? subtext(result) : undefined;
    if (sub) {
      for (const line of sub.split("\n")) {
        process.stdout.write(`${color.gray("│")}     ${line}\n`);
      }
    }
    return result;
  }

  const s = spinner();
  const start = Date.now();
  s.start(readMessage());

  const timer = setInterval(() => {
    s.message(`${readMessage()} [${formatElapsed(Date.now() - start)}]`);
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
        process.stdout.write(`${color.gray("│")}     ${line}\n`);
      }
    }

    return result;
  } catch (error) {
    clearInterval(timer);
    s.stop("", 1);
    throw error;
  }
}
