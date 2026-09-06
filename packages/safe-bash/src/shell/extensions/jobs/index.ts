import { commandRuntimeIdentity } from "../../../contracts/command.js";
import { writeText } from "../../../contracts/io.js";
import { concatShellValues, shellValueBytes, shellValueFromBytes } from "../../../contracts/value.js";
import type { ShellValue } from "../../../contracts/value.js";
import type { ShellBindingReference, ShellExtension, ShellExtensionContext, ShellExtensionInstance } from "../../extensions.js";
import { createJobState } from "./state.js";
import type { JobHandle, JobOutcome, JobState } from "./state.js";

const maximumWaitProcessId = 2147483647;

function waitProcessId(operand: string, flexible = false): number | undefined {
  let value = 0;
  let offset = 0;
  let negative = false;
  if (flexible) {
    while (offset < operand.length && (operand.charCodeAt(offset) === 32 || operand.charCodeAt(offset) >= 9 && operand.charCodeAt(offset) <= 13)) offset++;
    if (operand[offset] === "+" || operand[offset] === "-") negative = operand[offset++] === "-";
  }
  const firstDigit = offset;
  while (offset < operand.length) {
    const code = operand.charCodeAt(offset);
    if (code < 48 || code > 57) break;
    value = value * 10 + code - 48;
    if (value > maximumWaitProcessId + Number(negative)) return undefined;
    offset++;
  }
  if (offset === firstDigit) return undefined;
  while (offset < operand.length) {
    const code = operand.charCodeAt(offset++);
    if (code !== 32 && (code < 9 || code > 13)) return undefined;
  }
  return negative ? -value : value;
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
    let reference: ShellBindingReference | undefined;
    let primary: { reason: unknown } | undefined;
    const execute = async (): Promise<number> => {
      let offset = 0;
      let next = false;
      let destination: ShellValue | undefined;
      while (offset < context.args.length) {
        context.signal.throwIfAborted();
        const option = shellValueBytes(context.argumentValues[offset]!);
        if (option.length < 2 || option[0] !== 45) break;
        offset++;
        if (option.length === 2 && option[1] === 45) break;
        for (let index = 1; index < option.length; index++) {
          if (option[index] === 102) continue;
          if (option[index] === 110) { next = true; continue; }
          if (option[index] === 112) {
            if (index + 1 < option.length) destination = shellValueFromBytes(option.subarray(index + 1));
            else if (offset < context.args.length) destination = context.argumentValues[offset++]!;
            else {
              await context.diagnostic("wait: -p: option requires an argument");
              await writeText(context.stderr, "wait: usage: wait [-fn] [-p var] [id ...]\n");
              return 2;
            }
            break;
          }
          await context.diagnostic(concatShellValues(["wait: -", shellValueFromBytes(option.subarray(index, index + 1)), ": invalid option"]));
          await writeText(context.stderr, "wait: usage: wait [-fn] [-p var] [id ...]\n");
          return 2;
        }
      }
      if (destination !== undefined) {
        const prepared = await context.bindings.prepareReference(destination);
        if (!prepared.ok) { await context.diagnostic(concatShellValues(["wait: ", prepared.diagnostic])); return 1; }
        reference = prepared.value;
        const removed = await reference.unbindName();
        if (!removed.ok) { await context.diagnostic(concatShellValues(["wait: ", removed.diagnostic])); return 1; }
      }
      const publish = async (result: number, processId?: number): Promise<number> => {
        if (reference && processId !== undefined) {
          const assigned = await reference.assignInteger(processId);
          if (!assigned.ok) { await context.diagnostic(concatShellValues(["wait: ", assigned.diagnostic])); return 1; }
        }
        return result;
      };
      if (next) {
        for (let index = offset; index < context.args.length; index++) {
          context.signal.throwIfAborted();
          const processId = waitProcessId(context.args[index]!, true);
          const handle = processId === undefined || processId < 0 ? undefined : children.get(processId);
          const saved = handle && jobs!.savedStatus(handle);
          if (saved !== undefined) return await publish(saved, processId);
        }
        const active = new Set(jobs!.snapshot().filter(entry => entry.residency !== "saved").map(entry => entry.handle));
        const targets: { handle: JobHandle }[] = [];
        for (let index = offset; index < context.args.length; index++) {
          context.signal.throwIfAborted();
          const operand = context.args[index]!;
          const raw = context.argumentValues[index]!;
          const processId = waitProcessId(operand, true);
          const handle = processId === undefined ? undefined : children.get(processId);
          if (handle && active.has(handle)) { targets.push({ handle }); continue; }
          if ((processId === undefined || processId === -1) && operand.length && operand[0] !== "%") await context.diagnostic(concatShellValues(["wait: warning: ", raw, ": job specification requires leading `%'"]));
          await context.diagnostic(concatShellValues(["wait: `", raw, operand[0] === "%" ? "': no such job" : "': not a pid or valid job spec"]));
        }
        if (offset < context.args.length && !targets.length) return 127;
        const waited = await jobs!.waitNext(offset === context.args.length ? undefined : targets, { signal: context.signal });
        const result = status(waited.outcome);
        const processId = waited.handle && [...children].find(([, handle]) => handle === waited.handle)?.[0];
        return await publish(result, processId);
      }
      if (offset === context.args.length) {
        const result = await jobs!.wait(undefined, { signal: context.signal });
        children.clear();
        return status(result.outcome);
      }
      let result = 0;
      let returnedProcessId: number | undefined;
      for (; offset < context.args.length; offset++) {
        context.signal.throwIfAborted();
        const operand = context.args[offset]!;
        const raw = context.argumentValues[offset]!;
        const processId = waitProcessId(operand);
        returnedProcessId = undefined;
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
        } else {
          result = status((await jobs!.wait([{ handle }], { signal: context.signal })).outcome);
          returnedProcessId = processId;
        }
      }
      return await publish(result, returnedProcessId);
    };
    let result = 0;
    try { result = await execute(); }
    catch (reason) {
      primary = { reason };
      failure ??= primary;
    }
    try { await reference?.close(); }
    catch (reason) { primary ??= { reason }; failure ??= primary; }
    if (primary) throw primary.reason;
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
    checkpoint() { jobs!.retireNotified(); },
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
