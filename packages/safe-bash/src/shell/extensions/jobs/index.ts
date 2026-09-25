import { commandRuntimeIdentity } from "../../../contracts/command.js";
import { signalName } from "../../../commands/timeout/signal.js";
import { writeText } from "../../../contracts/io.js";
import { concatShellValues, shellValueBytes, shellValueFromBytes } from "../../../contracts/value.js";
import type { ShellValue } from "../../../contracts/value.js";
import type { ShellBindingReference, ShellExtension, ShellExtensionContext, ShellExtensionInstance } from "../../extensions.js";
import { createJobState } from "./state.js";
import type { JobHandle, JobOutcome, JobState, JobTarget } from "./state.js";

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

function instance(inherited?: number, getParent?: () => { jobs: JobState | undefined; children: ReadonlyMap<number, JobHandle> }): ShellExtensionInstance {
  let latest = inherited;
  let jobs: JobState | undefined;
  let failure: { reason: unknown } | undefined;
  const children = new Map<number, JobHandle>();
  const resolveFrom = (activeJobs: JobState, activeChildren: ReadonlyMap<number, JobHandle>, operand: string, flexible = false): JobHandle | undefined => {
    if (!operand.startsWith("%")) {
      const processId = waitProcessId(operand, flexible);
      return processId === undefined ? undefined : activeChildren.get(processId);
    }
    const listed = activeJobs.snapshot().filter(entry => entry.listed);
    const spec = operand.slice(1);
    if (spec === "" || spec === "%" || spec === "+") return listed.at(-1)?.handle;
    if (spec === "-") return listed.at(-2)?.handle;
    const jobId = waitProcessId(spec);
    return listed.find(entry => entry.handle.jobId === jobId)?.handle;
  };
  const resolve = (operand: string, flexible = false): JobHandle | undefined => resolveFrom(jobs!, children, operand, flexible);
  const list = async (context: ShellExtensionContext): Promise<number> => {
    let mode = "", offset = 0;
    for (; offset < context.args.length; offset++) {
      const option = context.args[offset]!;
      if (option === "--") { offset++; break; }
      if (!option.startsWith("-")) break;
      if (option === "-p" || option === "-l" || option === "-r" || option === "-s") mode = option;
      else { await context.diagnostic(`jobs: ${option}: invalid option`); return 2; }
    }
    let activeJobs = jobs!;
    let activeChildren: ReadonlyMap<number, JobHandle> = children;
    let listed = activeJobs.snapshot().filter(entry => entry.listed);
    if (listed.length === 0 && getParent) {
      const parent = getParent();
      if (parent.jobs) {
        activeJobs = parent.jobs;
        activeChildren = parent.children;
        listed = activeJobs.snapshot().filter(entry => entry.listed);
      }
    }
    let result = 0;
    const selected = offset === context.args.length ? listed.map(entry => entry.handle)
      : context.args.slice(offset).map(operand => resolveFrom(activeJobs, activeChildren, operand.startsWith("%") ? operand : `%${operand}`));
    for (const [index, handle] of selected.entries()) {
      if (!handle) { await context.diagnostic(`jobs: ${context.args[offset + index]}: no such job`); result = 1; continue; }
      const entry = listed.find(entry => entry.handle === handle);
      if (!entry || mode === "-s" || mode === "-r" && entry.state === "done") continue;
      const pid = [...activeChildren].find(([, child]) => child === handle)?.[0];
      if (mode === "-p") await writeText(context.stdout, `${pid}\n`);
      else {
        const marker = handle === listed.at(-1)?.handle ? "+" : handle === listed.at(-2)?.handle ? "-" : " ";
        const state = entry.state === "done" ? "Done" : "Running";
        await writeText(context.stdout, `[${handle.jobId}]${marker} ${mode === "-l" ? `${pid} ` : ""}${state}\n`);
      }
    }
    return result;
  };
  const kill = async (context: ShellExtensionContext): Promise<number> => {
    const signals: Readonly<Record<string, number>> = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`SIG${signalName(index + 1)}`, index + 1]));
    const signalNumber = (name: string): number | undefined => {
      const numeric = waitProcessId(name);
      if (numeric !== undefined) return numeric === 0 || Object.values(signals).includes(numeric) ? numeric : undefined;
      return signals[name.startsWith("SIG") ? name : `SIG${name}`];
    };
    let offset = 0, signal = signals.SIGTERM;
    if (context.args[0] === "-l" || context.args[0] === "-L") {
      if (context.args.length === 1) {
        await writeText(context.stdout, `${Object.keys(signals).map(name => name.slice(3)).join(" ")}\n`);
        return 0;
      }
      let result = 0;
      for (const operand of context.args.slice(1)) {
        const numeric = waitProcessId(operand);
        const number = numeric === undefined ? signalNumber(operand) : numeric > 128 ? numeric - 128 : numeric;
        const name = Object.keys(signals).find(name => signals[name] === number);
        if (!name) { await context.diagnostic(`kill: ${operand}: invalid signal specification`); result = 1; }
        else await writeText(context.stdout, `${numeric === undefined ? number : name.slice(3)}\n`);
      }
      return result;
    }
    if (context.args[0] === "-s" || context.args[0] === "-n") {
      signal = signalNumber(context.args[1] ?? "")!;
      offset = 2;
    } else if (context.args[0]?.startsWith("-") && context.args[0] !== "--") {
      signal = signalNumber(context.args[0].slice(1))!;
      offset = 1;
    }
    if (context.args[offset] === "--") offset++;
    if (signal === undefined || signal > 31) { await context.diagnostic("kill: invalid signal specification"); return 1; }
    if ([signals.SIGSTOP, signals.SIGTSTP, signals.SIGTTIN, signals.SIGTTOU, signals.SIGCONT, signals.SIGCHLD, signals.SIGURG, signals.SIGWINCH].includes(signal)) {
      await context.diagnostic("kill: signal is not supported by virtual job termination"); return 1;
    }
    if (offset >= context.args.length) { await context.diagnostic("kill: usage: kill [-s signal | -n signal | -signal] pid | %job ..."); return 2; }
    let result = 0;
    for (const operand of context.args.slice(offset)) {
      const handle = resolve(operand);
      if (!handle || !jobs!.signal(handle, signal)) { await context.diagnostic(`kill: ${operand}: no such ${operand.startsWith("%") ? "job" : "process"}`); result = 1; }
    }
    return result;
  };
  const disown = async (context: ShellExtensionContext): Promise<number> => {
    let all = false;
    let runningOnly = false;
    let nohupOnly = false;
    let offset = 0;
    for (; offset < context.args.length; offset++) {
      const arg = context.args[offset]!;
      if (arg === "--") { offset++; break; }
      if (!arg.startsWith("-") || arg === "-") break;
      for (let i = 1; i < arg.length; i++) {
        const ch = arg[i]!;
        if (ch === "a") all = true;
        else if (ch === "r") runningOnly = true;
        else if (ch === "h") nohupOnly = true;
        else {
          await context.diagnostic(`disown: -${ch}: invalid option`);
          return 2;
        }
      }
    }
    const listed = jobs!.snapshot().filter(entry => entry.listed);
    const removeHandle = (handle: JobHandle): void => {
      if (nohupOnly) return;
      jobs!.disown(handle);
      for (const [pid, child] of children) {
        if (child === handle) children.delete(pid);
      }
    };
    if (offset === context.args.length) {
      if (all || runningOnly) {
        for (const entry of listed) {
          if (runningOnly && entry.state === "done") continue;
          removeHandle(entry.handle);
        }
        return 0;
      }
      const current = listed.at(-1)?.handle;
      if (!current) {
        await context.diagnostic("disown: current: no such job");
        return 1;
      }
      removeHandle(current);
      return 0;
    }
    let statusCode = 0;
    for (let i = offset; i < context.args.length; i++) {
      const operand = context.args[i]!;
      const handle = resolve(operand) ?? resolve(operand.startsWith("%") ? operand : `%${operand}`);
      if (!handle) {
        await context.diagnostic(`disown: ${operand}: no such job`);
        statusCode = 1;
        continue;
      }
      removeHandle(handle);
    }
    return statusCode;
  };
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
    const ordinaryWait = async (targets?: readonly JobTarget[]) => {
      if (context.waitInterruptibly) return context.waitInterruptibly(signal => jobs!.wait(targets, { signal }));
      return { kind: "completed" as const, value: await jobs!.wait(targets, { signal: context.signal }) };
    };
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
          const handle = resolve(context.args[index]!, true);
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
          const handle = resolve(operand, true);
          if (handle && active.has(handle)) { targets.push({ handle }); continue; }
          if ((processId === undefined || processId === -1) && operand.length && operand[0] !== "%") await context.diagnostic(concatShellValues(["wait: warning: ", raw, ": job specification requires leading `%'"]));
          await context.diagnostic(concatShellValues(["wait: `", raw, operand[0] === "%" ? "': no such job" : "': not a pid or valid job spec"]));
        }
        if (offset < context.args.length && !targets.length) return 127;
        const selected = offset === context.args.length ? undefined : targets;
        const waited = context.waitInterruptibly
          ? await context.waitInterruptibly(signal => jobs!.waitNext(selected, { signal }))
          : { kind: "completed" as const, value: await jobs!.waitNext(selected, { signal: context.signal }) };
        if (waited.kind === "interrupted") return waited.status;
        const result = status(waited.value.outcome);
        const processId = waited.value.handle && [...children].find(([, handle]) => handle === waited.value.handle)?.[0];
        return await publish(result, processId);
      }
      if (offset === context.args.length) {
        const result = await ordinaryWait();
        if (result.kind === "interrupted") return result.status;
        children.clear();
        return status(result.value.outcome);
      }
      const waitOperands = async (signal: AbortSignal) => {
        let result = 0;
        let returnedProcessId: number | undefined;
        for (; offset < context.args.length; offset++) {
          signal.throwIfAborted();
          const operand = context.args[offset]!;
          const raw = context.argumentValues[offset]!;
          const processId = waitProcessId(operand);
          returnedProcessId = undefined;
          const handle = resolve(operand);
          if (operand.startsWith("%") && !handle) {
            await context.diagnostic(concatShellValues(["wait: `", raw, "': no such job"]));
            result = 127;
            continue;
          }
          if (processId === undefined && !operand.startsWith("%")) {
            await context.diagnostic(concatShellValues(["wait: `", raw, "': not a pid or valid job spec"]));
            if (operand.length && operand[0]! >= "0" && operand[0]! <= "9") return { result: 1, processId: undefined };
            result = 1;
            continue;
          }
          if (!handle) {
            await context.diagnostic(`wait: pid ${processId} is not a child of this shell`);
            result = 127;
          } else {
            const waited = await jobs!.wait([{ handle }], { signal });
            result = status(waited.outcome);
            returnedProcessId = [...children].find(([, child]) => child === handle)?.[0];
          }
        }
        return { result, processId: returnedProcessId };
      };
      const waited = context.waitInterruptibly
        ? await context.waitInterruptibly(waitOperands)
        : { kind: "completed" as const, value: await waitOperands(context.signal) };
      if (waited.kind === "interrupted") return waited.status;
      return await publish(waited.value.result, waited.value.processId);
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
    builtins: [{ name: "wait", execute: wait }, { name: "jobs", execute: list }, { name: "kill", execute: kill }, { name: "disown", execute: disown }],
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
    fork: () => instance(latest, () => ({ jobs, children })),
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
