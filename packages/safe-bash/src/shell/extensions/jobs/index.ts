import { commandRuntimeIdentity } from "../../../contracts/command.js";
import { writeText } from "../../../contracts/io.js";
import { concatShellValues, shellValueBytes, shellValueFromBytes } from "../../../contracts/value.js";
import type { ShellExtension, ShellExtensionContext, ShellExtensionInstance } from "../../extensions.js";
import { createJobState } from "./state.js";
import type { JobHandle, JobOutcome, JobState } from "./state.js";

const maximumWaitProcessId = 2147483647;

function waitProcessId(operand: string): number | undefined {
  let value = 0;
  let offset = 0;
  while (offset < operand.length) {
    const code = operand.charCodeAt(offset);
    if (code < 48 || code > 57) break;
    value = value * 10 + code - 48;
    if (value > maximumWaitProcessId) return undefined;
    offset++;
  }
  if (!offset) return undefined;
  while (offset < operand.length) {
    const code = operand.charCodeAt(offset++);
    if (code !== 32 && (code < 9 || code > 13)) return undefined;
  }
  return value;
}

function instance(inherited?: number): ShellExtensionInstance {
  let latest = inherited;
  let jobs: JobState | undefined;
  let failure: { reason: unknown } | undefined;
  const children = new Map<number, JobHandle>();
  const status = (outcome: JobOutcome): number => {
    if (outcome.kind === "failure") {
      failure ??= { reason: outcome.reason };
      throw outcome.reason;
    }
    return outcome.status;
  };
  const wait = async (context: ShellExtensionContext): Promise<number> => {
    let offset = 0;
    while (offset < context.args.length) {
      context.signal.throwIfAborted();
      const option = shellValueBytes(context.argumentValues[offset]!);
      if (option.length < 2 || option[0] !== 45) break;
      offset++;
      if (option.length === 2 && option[1] === 45) break;
      for (let index = 1; index < option.length; index++) {
        if (option[index] === 102) continue;
        await context.diagnostic(concatShellValues(["wait: -", shellValueFromBytes(option.subarray(index, index + 1)), ": invalid option"]));
        await writeText(context.stderr, "wait: usage: wait [-fn] [-p var] [id ...]\n");
        return 2;
      }
    }
    if (offset === context.args.length) {
      const result = await jobs!.wait(undefined, { signal: context.signal });
      children.clear();
      return status(result.outcome);
    }
    let result = 0;
    for (; offset < context.args.length; offset++) {
      context.signal.throwIfAborted();
      const operand = context.args[offset]!;
      const raw = context.argumentValues[offset]!;
      const processId = waitProcessId(operand);
      if (processId === undefined) {
        await context.diagnostic(concatShellValues(["wait: `", raw, "': not a pid or valid job spec"]));
        if (operand.length && operand[0]! >= "0" && operand[0]! <= "9") return 1;
        result = 1;
        continue;
      }
      const handle = children.get(processId);
      if (!handle) {
        await context.diagnostic(`wait: pid ${processId} is not a child of this shell`);
        result = 127;
      } else result = status((await jobs!.wait([{ handle }], { signal: context.signal })).outcome);
    }
    return result;
  };
  return {
    builtins: [{ name: "wait", execute: wait }],
    start(context) {
      const registerExecutionCleanup = context.registerExecutionCleanup;
      if (typeof registerExecutionCleanup !== "function") throw new TypeError("Jobs require execution-scoped cleanup ownership");
      let ownerSignal = context.signal;
      let retired!: () => void;
      const retirement = new Promise<void>(resolve => { retired = resolve; });
      let completion: Promise<void> | undefined;
      const finish = (): Promise<void> => {
        retired();
        if (!completion) {
          completion = Promise.resolve().then(async () => {
            if (jobs) {
              try {
                if (ownerSignal.aborted) await jobs.close(ownerSignal.reason);
                else await jobs.finish();
              } catch (reason) { failure ??= { reason }; }
            }
            if (failure) throw failure.reason;
          });
          void completion.catch(() => undefined);
        }
        return completion;
      };
      try {
        const signal = registerExecutionCleanup.call(context, async () => {
          try { await retirement; await finish(); }
          finally { ownerSignal.removeEventListener("abort", retired); }
        });
        if (!(signal instanceof AbortSignal)) throw new TypeError("Execution cleanup must provide its owner cancellation signal");
        ownerSignal = signal;
        ownerSignal.addEventListener("abort", retired, { once: true });
        if (ownerSignal.aborted) retired();
        context.registerCleanup(() => { void finish(); });
        jobs = createJobState({ signal: ownerSignal });
      } catch (reason) { void finish(); throw reason; }
    },
    fork: () => instance(latest),
    listTerminators: [{ operator: "&", async execute(context) {
      let processId: number | undefined;
      const handle = await jobs!.start(async task => {
        const child = await context.prepareChild({ ...task, stdin: "async-default" });
        processId = child.processId;
        return child;
      });
      children.set(processId!, handle);
      latest = processId;
      return 0;
    } }],
    specialParameters: [{ name: "!", lookup: () => latest === undefined ? undefined : String(latest) }],
  };
}

export function jobsExtension(): ShellExtension {
  return {
    name: "jobs", runtimeIdentity: commandRuntimeIdentity,
    syntax: { listTerminators: [{ operator: "&" }], specialParameters: [{ name: "!" }] },
    create: () => instance(),
  };
}
