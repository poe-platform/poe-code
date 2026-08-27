import type { FileSystem } from "../../contracts/filesystem.js";
import { onlyKeys, record, stringValue, withSignal } from "./values.js";

export interface ShellGuestOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
}

export interface ShellExecutionOptions extends ShellGuestOptions {
  readonly fs: FileSystem;
  readonly signal: AbortSignal;
}

export interface ShellExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type ShellExecute = (
  source: string,
  options: ShellExecutionOptions,
) => ShellExecutionResult | Promise<ShellExecutionResult>;

export interface ShellExecutor {
  exec: ShellExecute;
}

export type ShellHostOperation = (
  source: string,
  options?: ShellGuestOptions,
) => Promise<ShellExecutionResult>;

export type DeclareShellHostOperation = (
  operation: ShellHostOperation,
  policy: "read-side-effect",
) => ShellHostOperation;

export interface SafeJsShellOptions {
  readonly fs: FileSystem;
  readonly signal: AbortSignal;
  readonly replayPolicy: "read-side-effect";
  readonly declareHostOperation: DeclareShellHostOperation;
}

function guestOptions(value: unknown): ShellGuestOptions {
  if (value === undefined) return {};
  const options = record(value, "shell options");
  onlyKeys(options, ["cwd", "env", "stdin"]);
  const env = options.env === undefined ? undefined : record(options.env, "env");
  const entries = env === undefined ? undefined : Object.entries(env).map(([key, entry]): [string, string] => {
    if (key.includes("\0") || key.includes("=")) throw new TypeError("Invalid environment key");
    const text = stringValue(entry, `env.${key}`);
    if (text.includes("\0")) throw new TypeError("Invalid environment value");
    return [key, text];
  });
  return {
    ...(options.cwd === undefined ? {} : { cwd: stringValue(options.cwd, "cwd") }),
    ...(options.stdin === undefined ? {} : { stdin: stringValue(options.stdin, "stdin") }),
    ...(entries === undefined ? {} : { env: Object.fromEntries(entries) }),
  };
}

export function makeSafeJsShellModule(
  executor: ShellExecute | ShellExecutor,
  options: SafeJsShellOptions,
): { exec: ShellHostOperation } {
  if (options.fs === undefined) throw new TypeError("An explicit filesystem is required");
  if (!(options.signal instanceof AbortSignal)) throw new TypeError("An explicit signal is required");
  if (options.replayPolicy !== "read-side-effect") {
    throw new TypeError("Shell operations require the read-side-effect replay policy");
  }
  if (typeof options.declareHostOperation !== "function") {
    throw new TypeError("SafeJS declareHostOperation must be injected");
  }
  const execute = typeof executor === "function" ? executor : executor.exec.bind(executor);
  if (typeof execute !== "function") throw new TypeError("A shell executor is required");
  async function exec(source: string, input?: ShellGuestOptions): Promise<ShellExecutionResult> {
    const text = stringValue(source, "source");
    const request = guestOptions(input);
    return withSignal(options.signal, async () => {
      const result = await execute(text, { ...request, fs: options.fs, signal: options.signal });
      if (!Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255) {
        throw new TypeError("Shell exitCode must be an integer between 0 and 255");
      }
      return {
        stdout: stringValue(result.stdout, "stdout"),
        stderr: stringValue(result.stderr, "stderr"),
        exitCode: result.exitCode,
      };
    });
  }
  return { exec: options.declareHostOperation(exec, options.replayPolicy) };
}
