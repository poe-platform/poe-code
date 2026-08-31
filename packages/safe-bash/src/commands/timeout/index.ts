import { getCommandArguments, writeBytes, type CommandContext, type CommandDefinition, type CommandInvoker, type VirtualShellPlugin } from "../../contracts/index.js";
import { parseDuration } from "./duration.js";
import { createDeadline, defaultSchedulerBinding, type SchedulerBinding } from "./scheduler.js";

export interface TimeoutScheduler {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TimeoutCommandOptions {
  readonly invoke?: CommandInvoker | undefined;
  readonly scheduler?: TimeoutScheduler | undefined;
  readonly maxTimerMilliseconds?: number | undefined;
}

export interface TimeoutCommandsOptions extends TimeoutCommandOptions {
  readonly replace?: boolean | undefined;
}

interface Settings {
  readonly invoke: CommandInvoker | undefined;
  readonly scheduler: SchedulerBinding;
  readonly maxTimerMilliseconds: number;
  readonly replace: boolean;
}

const encoder = new TextEncoder();
const records = Object.freeze({
  missingDuration: encoder.encode("timeout: missing duration\n"),
  invalidDuration: encoder.encode("timeout: invalid duration\n"),
  durationOverflow: encoder.encode("timeout: duration exceeds supported range\n"),
  missingCommand: encoder.encode("timeout: missing command\n"),
  invalidOption: encoder.encode("timeout: invalid option\n"),
  preserveStatus: encoder.encode("timeout: option --preserve-status is unsupported\n"),
  signal: encoder.encode("timeout: option --signal is unsupported\n"),
  killAfter: encoder.encode("timeout: option --kill-after is unsupported\n"),
  foreground: encoder.encode("timeout: option --foreground is unsupported\n"),
  verbose: encoder.encode("timeout: option --verbose is unsupported\n"),
  invokeUnavailable: encoder.encode("timeout: command invocation is unavailable\n"),
  timerSetupFailed: encoder.encode("timeout: timer setup failed\n"),
  help: encoder.encode("Usage: timeout [OPTION] DURATION COMMAND [ARG]...\nRun a virtual-bash command with a cooperative time limit.\n"),
  version: encoder.encode("timeout (virtual-bash cooperative profile)\n"),
});

function optionsObject(value: unknown): Record<PropertyKey, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Timeout options must be an object");
  return value as Record<PropertyKey, unknown>;
}

function settings(value: unknown, includeReplace: boolean): Settings {
  const options = optionsObject(value);
  const invokeValue = options?.invoke;
  if (invokeValue !== undefined && typeof invokeValue !== "function") throw new TypeError("Timeout invoke must be a function");
  const invoke = invokeValue as CommandInvoker | undefined;
  const scheduler = options?.scheduler;
  let binding = defaultSchedulerBinding;
  if (scheduler !== undefined) {
    if (scheduler === null || typeof scheduler !== "object" || Array.isArray(scheduler)) throw new TypeError("Timeout scheduler must be an object");
    const provider = scheduler as Record<PropertyKey, unknown>;
    const now = provider.now;
    const setTimeout = provider.setTimeout;
    const clearTimeout = provider.clearTimeout;
    if (typeof now !== "function" || typeof setTimeout !== "function" || typeof clearTimeout !== "function") {
      throw new TypeError("Timeout scheduler methods must be functions");
    }
    binding = {
      receiver: scheduler,
      now: now as TimeoutScheduler["now"],
      setTimeout: setTimeout as TimeoutScheduler["setTimeout"],
      clearTimeout: clearTimeout as TimeoutScheduler["clearTimeout"],
    };
  }
  const maximum = options?.maxTimerMilliseconds;
  if (maximum !== undefined && typeof maximum !== "number") throw new TypeError("Timeout maxTimerMilliseconds must be a number");
  if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 1 || maximum > 2147483647)) {
    throw new RangeError("Timeout maxTimerMilliseconds must be an integer from 1 through 2147483647");
  }
  let replace = false;
  if (includeReplace) {
    const configured = options?.replace;
    if (configured !== undefined && typeof configured !== "boolean") throw new TypeError("Timeout replace must be a boolean");
    replace = configured ?? false;
  }
  return { invoke, scheduler: binding, maxTimerMilliseconds: maximum ?? 2147483647, replace };
}

function unsupported(token: string): Uint8Array | undefined {
  const first = token.length > 1 && token.charCodeAt(0) === 45 && token.charCodeAt(1) !== 45 ? token.charCodeAt(1) : -1;
  if (token === "--preserve-status" || token.startsWith("--preserve-status=") || first === 112) return records.preserveStatus;
  if (token === "--signal" || token.startsWith("--signal=") || first === 115) return records.signal;
  if (token === "--kill-after" || token.startsWith("--kill-after=") || first === 107) return records.killAfter;
  if (token === "--foreground" || token.startsWith("--foreground=") || first === 102) return records.foreground;
  if (token === "--verbose" || token.startsWith("--verbose=") || first === 118) return records.verbose;
  return undefined;
}

async function status(context: CommandContext, bytes: Uint8Array, exitCode: number, stdout = false): Promise<{ exitCode: number }> {
  await writeBytes(stdout ? context.stdout : context.stderr, bytes, context.signal);
  return { exitCode };
}

function childInvoker(context: CommandContext, fallback: CommandInvoker | undefined): { readonly invoke: CommandInvoker; readonly receiver: unknown } | undefined {
  if ("invoke" in context) {
    const invoke = context.invoke;
    return typeof invoke === "function" ? { invoke, receiver: context } : undefined;
  }
  return fallback === undefined ? undefined : { invoke: fallback, receiver: undefined };
}

function definition(configuration: Settings): CommandDefinition {
  return Object.freeze({
    name: "timeout",
    description: "Run a virtual command with a cooperative time limit",
    async execute(context: CommandContext) {
      const originalArgs = context.args;
      let offset = 0;
      while (offset < originalArgs.length) {
        const token = originalArgs[offset]!;
        if (token === "--") {
          offset++;
          break;
        }
        if (token === "--help") return status(context, records.help, 0, true);
        if (token === "--version") return status(context, records.version, 0, true);
        if (token === "-" || !token.startsWith("-")) break;
        const record = unsupported(token);
        return status(context, record ?? records.invalidOption, 125);
      }
      const durationToken = originalArgs[offset];
      if (durationToken === undefined) return status(context, records.missingDuration, 125);
      const parsed = parseDuration(durationToken);
      if (parsed.kind === "invalid") return status(context, records.invalidDuration, 125);
      if (parsed.kind === "overflow") return status(context, records.durationOverflow, 125);
      const command = originalArgs[offset + 1];
      if (command === undefined) return status(context, records.missingCommand, 125);
      const selected = childInvoker(context, configuration.invoke);
      if (selected === undefined) return status(context, records.invokeUnavailable, 125);
      const suppliedValues = "argumentValues" in context ? context.argumentValues : undefined;
      const argumentValues = suppliedValues === undefined ? undefined
        : getCommandArguments({ args: originalArgs, argumentValues: suppliedValues }).slice(offset + 2);
      const args = argumentValues?.args ?? Object.freeze(originalArgs.slice(offset + 2));
      const streams = {
        ...(argumentValues === undefined ? {} : { argumentValues }),
        stdin: context.stdin,
        ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
        stdout: context.stdout,
        stderr: context.stderr,
      };
      if (parsed.milliseconds === 0) {
        return Reflect.apply(selected.invoke, selected.receiver, [command, args, streams]);
      }

      context.signal.throwIfAborted();
      const deadline = createDeadline(configuration.scheduler, parsed.milliseconds, configuration.maxTimerMilliseconds);
      context.registerCleanup?.(deadline.retire);
      try { deadline.start(); }
      catch {
        let retirementFailed = false;
        let retirementFailure: unknown;
        try { await deadline.retire(); }
        catch (error) {
          retirementFailed = true;
          retirementFailure = error;
        }
        context.signal.throwIfAborted();
        if (retirementFailed) throw retirementFailure;
        return status(context, records.timerSetupFailed, 125);
      }

      let returned = false;
      let result: { readonly exitCode: number } | undefined;
      let invocationFailure: unknown;
      try {
        result = await Reflect.apply(selected.invoke, selected.receiver, [command, args, { signal: deadline.signal, ...streams }]);
        returned = true;
      } catch (error) {
        invocationFailure = error;
      }
      let retirementFailed = false;
      let retirementFailure: unknown;
      try { await deadline.retire(); }
      catch (error) {
        retirementFailed = true;
        retirementFailure = error;
      }
      context.signal.throwIfAborted();
      if (!returned && invocationFailure !== deadline.deadlineReason && invocationFailure !== deadline.timerFailureReason) throw invocationFailure;
      if (retirementFailed) throw retirementFailure;
      if (!returned && invocationFailure === deadline.deadlineReason) return { exitCode: 124 };
      if (!returned && invocationFailure === deadline.timerFailureReason) return status(context, records.timerSetupFailed, 125);
      return result!;
    },
  });
}

export function createTimeoutCommand(options?: TimeoutCommandOptions): CommandDefinition {
  return definition(settings(options, false));
}

export function createTimeoutCommands(options?: TimeoutCommandsOptions): readonly CommandDefinition[] {
  return Object.freeze([definition(settings(options, true))]);
}

export function timeoutCommands(options?: TimeoutCommandsOptions): VirtualShellPlugin {
  const configuration = settings(options, true);
  const commands = Object.freeze([definition(configuration)]);
  return {
    name: "timeout-commands",
    setup(host) {
      if (!configuration.replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace: configuration.replace });
    },
  };
}
