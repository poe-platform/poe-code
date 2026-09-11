import { writeDiagnostic } from "../../escaping.js";
import { FsError, writeBytes, type CommandContext, type CommandDefinition } from "../../contracts/index.js";

export interface SleepScheduler {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TimeEnvLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
  readonly maxOutputBytes: number;
  readonly maxEnvironmentEntries: number;
  readonly maxFormatWidth: number;
}

export interface TimeEnvCommandsOptions {
  readonly replace?: boolean;
  readonly clock?: () => number;
  readonly defaultTimeZone?: string;
  readonly scheduler?: SleepScheduler;
  readonly maxTimerMilliseconds?: number;
  readonly limits?: Partial<TimeEnvLimits>;
}

export interface Settings {
  readonly clock: () => number;
  readonly defaultTimeZone: string;
  readonly scheduler: SleepScheduler;
  readonly maxTimerMilliseconds: number;
  readonly limits: TimeEnvLimits;
}

export function settings(options: TimeEnvCommandsOptions): Settings {
  const limits: TimeEnvLimits = { maxArguments: 4096, maxArgumentBytes: 65536, maxOutputBytes: 1024 * 1024,
    maxEnvironmentEntries: 10000, maxFormatWidth: 4096, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid time-env limit: ${name}`);
  }
  const maxTimerMilliseconds = options.maxTimerMilliseconds ?? 2147483647;
  if (!Number.isInteger(maxTimerMilliseconds) || maxTimerMilliseconds < 1 || maxTimerMilliseconds > 2147483647) {
    throw new RangeError("maxTimerMilliseconds must be between1 and2147483647");
  }
  const scheduler: SleepScheduler = options.scheduler ?? {
    now: () => performance.now(),
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  if (typeof scheduler.now !== "function" || typeof scheduler.setTimeout !== "function" || typeof scheduler.clearTimeout !== "function") {
    throw new TypeError("Invalid sleep scheduler");
  }
  if (options.clock !== undefined && typeof options.clock !== "function") throw new TypeError("Invalid date clock");
  return { clock: options.clock ?? Date.now, defaultTimeZone: options.defaultTimeZone ?? "UTC",
    scheduler, maxTimerMilliseconds, limits };
}

export class CommandFailure extends Error {
  constructor(message: string, readonly exitCode = 1) { super(message); }
}

export function checkSize(size: number, maximum: number, label: string): void {
  if (size > maximum) throw new FsError("EFBIG", { message: `time-env ${label} limit exceeded` });
}

export async function emit(context: CommandContext, value: string, limits: TimeEnvLimits): Promise<void> {
  checkSize(Buffer.byteLength(value), limits.maxOutputBytes, "output");
  const bytes = new TextEncoder().encode(value);
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    await writeBytes(context.stdout, bytes.slice(offset, offset + 16384), context.signal);
  }
}

export function command(name: string, configuration: Settings,
  execute: (context: CommandContext) => Promise<number>): CommandDefinition {
  return { name, async execute(context) {
    context.signal.throwIfAborted();
    checkSize(context.args.length, configuration.limits.maxArguments, "argument count");
    let size = 0;
    for (const argument of context.args) {
      size += Buffer.byteLength(argument);
      checkSize(size, configuration.limits.maxArgumentBytes, "argument");
    }
    try { return { exitCode: await execute(context) }; }
    catch (error) {
      context.signal.throwIfAborted();
      if (!(error instanceof CommandFailure)) throw error;
      await writeDiagnostic(context.stderr, `${name}: ${error.message}\n`, context.signal);
      return { exitCode: error.exitCode };
    }
  } };
}

export function ownEnvironment(context: CommandContext, name: string): string | undefined {
  return Object.hasOwn(context.env, name) ? context.env[name] : undefined;
}
