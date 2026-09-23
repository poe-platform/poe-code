import { getCommandArguments, writeBytes, type CommandContext, type CommandDefinition, type CommandInvoker, type VirtualShellPlugin } from "../../contracts/index.js";
import { parseDuration } from "./duration.js";
import { parseSignal } from "./signal.js";
import { createDeadline, defaultSchedulerBinding, type SchedulerBinding } from "./scheduler.js";

export interface TimeoutScheduler {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TimeoutCommandOptions {
  /** Trusted host binding responsible for signalling, hard escalation and child cleanup. */
  readonly killAfterPolicy?: KillAfterPolicy | undefined;
  readonly invoke?: CommandInvoker | undefined;
  readonly scheduler?: TimeoutScheduler | undefined;
  readonly maxTimerMilliseconds?: number | undefined;
}

export type KillAfterPolicy = (
  context: CommandContext,
  command: string,
  args: readonly string[],
  options: NonNullable<Parameters<CommandInvoker>[2]>,
  policy: Readonly<{ durationMilliseconds: number; killAfterMilliseconds: number; signalNumber: number; preserveStatus: boolean }>,
) => Promise<{ readonly exitCode: number }>;

export interface TimeoutCommandsOptions extends TimeoutCommandOptions {
  readonly replace?: boolean | undefined;
}

interface Settings {
  readonly killAfterPolicy: KillAfterPolicy | undefined;
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
  invalidSignal: encoder.encode("timeout: invalid signal\n"),
  killAfter: encoder.encode("timeout: kill-after escalation requires a host policy binding\n"),
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
  const killAfterPolicy = options?.killAfterPolicy;
  if (killAfterPolicy !== undefined && typeof killAfterPolicy !== "function") throw new TypeError("Timeout killAfterPolicy must be a function");
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
  return { invoke, killAfterPolicy: killAfterPolicy as KillAfterPolicy | undefined, scheduler: binding, maxTimerMilliseconds: maximum ?? 2147483647, replace };
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
      let preserveStatus = false;
      let verbose = false;
      let signalNumber = 15;
      let killAfterMilliseconds: number | undefined;
      while (offset < originalArgs.length) {
        const token = originalArgs[offset]!;
        if (token === "--") {
          offset++;
          break;
        }
        if (token === "--help") return status(context, records.help, 0, true);
        if (token === "--version") return status(context, records.version, 0, true);
        if (token === "-" || !token.startsWith("-")) break;
        if (token === "-v" || token === "--verbose") {
          verbose = true;
          offset++;
          continue;
        }
        // Virtual invocation already runs without a separate POSIX process group.
        if (token === "--foreground" || token === "-f") {
          offset++;
          continue;
        }
        if (token === "--preserve-status" || token === "-p") {
          preserveStatus = true;
          offset++;
          continue;
        }
        if (token === "--kill-after" || token.startsWith("--kill-after=") || token.startsWith("-k")) {
          const duration = token === "--kill-after" ? originalArgs[++offset]
            : token.startsWith("--kill-after=") ? token.slice(13) : token.slice(2) || originalArgs[++offset];
          if (duration === undefined) return status(context, records.missingDuration, 125);
          const killAfter = parseDuration(duration);
          if (killAfter.kind === "invalid") return status(context, records.invalidDuration, 125);
          if (killAfter.kind === "overflow") return status(context, records.durationOverflow, 125);
          killAfterMilliseconds = killAfter.milliseconds;
          offset++;
          continue;
        }
        let signalToken: string | undefined;
        if (token === "--signal") signalToken = originalArgs[++offset];
        else if (token.startsWith("--signal=")) signalToken = token.slice(9);
        else if (token.startsWith("-s")) signalToken = token.slice(2) || originalArgs[++offset];
        if (signalToken !== undefined) {
          const parsedSignal = parseSignal(signalToken);
          if (parsedSignal === undefined) return status(context, records.invalidSignal, 125);
          signalNumber = parsedSignal;
          offset++;
          continue;
        }
        return status(context, records.invalidOption, 125);
      }
      const durationToken = originalArgs[offset];
      if (durationToken === undefined) return status(context, records.missingDuration, 125);
      const parsed = parseDuration(durationToken);
      if (parsed.kind === "invalid") return status(context, records.invalidDuration, 125);
      if (parsed.kind === "overflow") return status(context, records.durationOverflow, 125);
      const command = originalArgs[offset + 1];
      if (command === undefined) return status(context, records.missingCommand, 125);
      const selected = childInvoker(context, configuration.invoke);
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
      if (killAfterMilliseconds !== undefined && killAfterMilliseconds !== 0 && configuration.killAfterPolicy !== undefined && parsed.milliseconds !== 0) {
        context.signal.throwIfAborted();
        const result = await configuration.killAfterPolicy(context, command, args, { signal: context.signal, ...streams }, Object.freeze({
          durationMilliseconds: parsed.milliseconds, killAfterMilliseconds, signalNumber, preserveStatus,
        }));
        context.signal.throwIfAborted();
        return result;
      }
      if (parsed.milliseconds === 0) {
        if (selected === undefined) return status(context, records.invokeUnavailable, 125);
        return Reflect.apply(selected.invoke, selected.receiver, [command, args, streams]);
      }

      if (selected === undefined) return status(context, records.invokeUnavailable, 125);

      context.signal.throwIfAborted();
      const deadline = createDeadline(configuration.scheduler, parsed.milliseconds, configuration.maxTimerMilliseconds, signalNumber !== 0);
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
      if (verbose && deadline.expired) {
        await writeBytes(context.stderr, encoder.encode(`timeout: cooperative deadline expired for command ‘${command}’\n`), context.signal);
      }
      if (!returned && deadline.expired && killAfterMilliseconds !== undefined && killAfterMilliseconds !== 0 && signalNumber !== 9) {
        return status(context, records.killAfter, 125);
      }
      if (!returned && invocationFailure === deadline.deadlineReason) return { exitCode: signalNumber === 9 || preserveStatus ? 128 + signalNumber : 124 };
      if (!returned && invocationFailure === deadline.timerFailureReason) return status(context, records.timerSetupFailed, 125);
      if (deadline.expired && (!preserveStatus || signalNumber === 9)) return { exitCode: signalNumber === 9 ? 137 : 124 };
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
