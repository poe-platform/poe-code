import { Worker } from "node:worker_threads";
import type { CommandRegistry } from "../contracts/index.js";
import { FsError, readBytes, writeBytes } from "../contracts/index.js";
import type { KillAfterPolicy } from "../commands/timeout/index.js";
import type { ShellOptions } from "../shell/types.js";
import { agentWorkerRecipes, hostDispatchCommands } from "../plugins/worker-recipes.js";
import type { WorkerMessage, WorkerModule } from "./protocol.js";
import { filesystemOptionsIndex } from "./protocol.js";
import { createDeadline, defaultSchedulerBinding, type Deadline } from "../commands/timeout/scheduler.js";
import { workerRuntimeContexts, shellDescriptorAdmissions } from "./runtime-context.js";
import { signalName } from "../commands/timeout/signal.js";
export type { WorkerModule } from "./protocol.js";

export interface WorkerShellOptions extends ShellOptions {
  /** Factories returning plugins or extensions, replayed inside the worker. */
  readonly workerModules?: readonly WorkerModule[];
}

const filesystemMethods = Object.keys(filesystemOptionsIndex) as (keyof typeof filesystemOptionsIndex)[];

export function createWorkerKillAfterPolicy(registry: () => CommandRegistry, configuration: WorkerShellOptions, requiresModules: () => boolean = () => false): KillAfterPolicy {
  return async (context, command, args, options, policy) => {
    context.signal.throwIfAborted();
    const runtimeContext = workerRuntimeContexts.get(context);
    const fs = runtimeContext?.fs ?? context.fs;
    // These counters/leases belong to the interpreter, not to a separate Shell.
    // Until a shared ledger is available, refuse rather than reset their quota.
    const limits = runtimeContext?.budget.limits ?? configuration.limits;
    const shared = ["maxCommands", "maxLoopIterations", "maxSourceBytes", "maxParseUnits", "maxExpansionBytes", "maxExpansionFields", "maxPipelineStages", "maxSubstitutionDepth", "maxCpuMs"] as const;
    if (shared.some(key => limits?.[key] !== undefined && limits[key] !== Infinity)) {
      await writeBytes(context.stderr, new TextEncoder().encode("timeout: worker escalation cannot preserve finite shared interpreter quotas\n"), context.signal);
      return { exitCode: 125 };
    }
    const recipes: { options: unknown; names: string[] }[] = [];
    const byRecipe = new Map<object, typeof recipes[number]>();
    const unsupported: string[] = [];
    for (const definition of registry().list()) {
      if (hostDispatchCommands.has(definition.execute)) continue;
      const recipe = agentWorkerRecipes.get(definition.execute);
      if (!recipe) { unsupported.push(definition.name); continue; }
      let group = byRecipe.get(recipe);
      if (!group) {
        group = { options: structuredClone(recipe), names: [] };
        byRecipe.set(recipe, group);
        recipes.push(group);
      }
      group.names.push(definition.name);
    }
    // Fail admission rather than silently substitute defaults for host closures.
    const customCapabilities = Object.keys(context.capabilities ?? {}).some(name => !["predicateIdentity", "regex", "timeoutKillAfterPolicy"].includes(name));
    if ((unsupported.length || configuration.extensions?.length || requiresModules() || customCapabilities) && !configuration.workerModules?.length) {
      await writeBytes(context.stderr, new TextEncoder().encode("timeout: worker modules are required for custom commands or extensions\n"), context.signal);
      return { exitCode: 125 };
    }
    if (context.admittedHandles !== undefined && shellDescriptorAdmissions.get(context.admittedHandles) !== true || context.processSignals !== undefined) {
      await writeBytes(context.stderr, new TextEncoder().encode("timeout: retained handles and process signal bindings cannot cross the worker boundary\n"), context.signal);
      return { exitCode: 125 };
    }
    const child = new AbortController();
    const signal = AbortSignal.any([context.signal, child.signal]);
    const admitted = new Set<Promise<void>>();
    const scopes = new Map<object | symbol, number>();
    const readers = new Map<number, AsyncGenerator<Uint8Array>>();
    const signalScopes = new Map<number, { controller: AbortController; signal: AbortSignal }>();
    function scopeFor(id: number) {
      let scope = signalScopes.get(id);
      if (!scope) {
        const controller = new AbortController();
        scope = { controller, signal: AbortSignal.any([signal, controller.signal]) };
        signalScopes.set(id, scope);
      }
      return scope;
    }
    let readerSequence = 0;
    let dispositions = new Map<number, "ignore" | "trap">();
    let open = true;
    let worker: Worker | undefined;
    let deadline: Deadline | undefined;
    let escalation: Deadline | undefined;
    let expired = false;
    let stopped = false;
    let killed = false;
    let retirement: Promise<void> | undefined;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let diagnostics = Promise.resolve();
    let finish: ((result: { exitCode: number }) => void) | undefined;
    let fail: ((error: unknown) => void) | undefined;
    const result = new Promise<{ exitCode: number }>((resolve, reject) => { finish = resolve; fail = reject; });
    const retire = (): Promise<void> => retirement ??= (async () => {
      open = false;
      child.abort(new Error("Worker invocation retired"));
      context.signal.removeEventListener("abort", cancel);
      const cleanup = await Promise.allSettled([
        Promise.resolve().then(() => deadline?.retire()),
        Promise.resolve().then(() => escalation?.retire()),
        Promise.resolve().then(() => worker?.terminate()),
        diagnostics,
      ]);
      await Promise.allSettled([...admitted]);
      const streamCleanup = await Promise.allSettled([...readers.values()].map(reader => reader.return(undefined)));
      readers.clear();
      signalScopes.clear();
      // The borrowed stream belongs to the caller; do not consume its tail or
      // close sibling pipeline resources when the child has not read stdin.
      const failures = [...cleanup, ...streamCleanup].filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length === 1) throw failures[0]!.reason;
      if (failures.length > 1) throw new AggregateError(failures.map(result => result.reason), "Worker retirement failed");
    })();
    const cancel = (): void => {
      void retire().then(() => fail!(context.signal.reason), fail);
    };
    const reportSignal = (number: number): void => {
      if (!policy.verbose) return;
      diagnostics = diagnostics.then(() => writeBytes(context.stderr, new TextEncoder().encode(`timeout: sending signal ${signalName(number)} to command ‘${command}’\n`), context.signal));
      void diagnostics.catch(error => fail!(error));
    };
    context.registerCleanup?.(retire);
    context.signal.addEventListener("abort", cancel, { once: true });
    try {
      context.signal.throwIfAborted();
      const source = import.meta.url.endsWith(".ts");
      const entry = new URL(source ? "./entry.ts"
        : new URL(import.meta.url).pathname.endsWith("/worker/host.js") ? "./entry.js" : "./safe-bash-worker-entry.js", import.meta.url);
      const data = {
        command, args: [...args], cwd: context.cwd, env: context.env, recipes,
        modules: configuration.workerModules ?? [],
        limits: limits && Object.fromEntries(Object.entries(limits).filter(([, value]) => value !== Infinity)),
        stdinIsDefault: options.stdinIsDefault,
        argumentBytes: options.argumentValues?.values.map((_value, index) => options.argumentValues!.bytes(index)),
        umask: runtimeContext?.umask,
        ignoredSignals: (runtimeContext?.ignoredSignals ?? []).filter(number => number !== 9 && number !== 19),
        readStream: typeof fs.readStream === "function",
        shellCapabilities: { predicateIdentity: context.capabilities?.predicateIdentity },
        // The RPC surface exposes pathname operations, not retained handles,
        // callbacks, stream factories or transactional publication authority.
        capabilities: Object.fromEntries(Object.entries(fs.capabilities).map(([name, value]) => [name,
          ["readOnly", "read", "stat", "readdir", "realpath", "access", "write", "append", "exclusiveCreate", "explicitDirectories", "implicitDirectories", "mkdir", "recursiveMkdir", "remove", "removeDirectory", "recursiveRemove", "rename", "copy", "exclusiveCopy", "readlink", "truncate", "symlinks", "hardlinks", "permissions", "timestamps", "atomicRename", "snapshotRmdir", "streamingRead"].includes(name) ? value : false])),
        methods: filesystemMethods.filter(method => typeof fs[method] === "function"),
      };
      const execArgv: string[] = [];
      for (let index = 0; index < process.execArgv.length; index++) {
        const argument = process.execArgv[index]!;
        if (argument === "--input-type") { index++; continue; }
        if (!argument.startsWith("--input-type=")) execArgv.push(argument);
      }
      worker = source
        ? new Worker(`import('node:worker_threads').then(({ workerData }) => import('tsx/esm/api').then(({ tsImport }) => tsImport(workerData.entry, ${JSON.stringify(import.meta.url)})));`, { eval: true, execArgv, workerData: { ...data, entry: entry.href } })
        : new Worker(entry, { execArgv, workerData: data });
      worker.on("error", fail!);
      worker.on("exit", code => {
        if (open) fail!(new Error(`timeout worker exited before completion (${code})`));
      });
      worker.on("message", (message: WorkerMessage) => {
        if (!open) return;
        if (message.kind === "cancel") {
          scopeFor(message.signalScope).controller.abort(new Error("Worker filesystem scope cancelled"));
        } else if (message.kind === "release") {
          signalScopes.delete(message.signalScope);
        } else if (message.kind === "ready") {
          const expected = registry().list().filter(definition => !hostDispatchCommands.has(definition.execute)).map(definition => definition.name).sort();
          const received = [...message.commands].sort();
          if (expected.length !== received.length || expected.some((name, index) => name !== received[index])) {
            fail!(new Error("Worker modules do not reproduce the command registry"));
            return;
          }
          dispositions = new Map(data.ignoredSignals.map(number => [number, "ignore" as const]));
          // Bootstrap imports and command installation precede invocation.
          // Start the utility deadline when the admitted child starts running.
          deadline = createDeadline(defaultSchedulerBinding, policy.durationMilliseconds, 2147483647);
          deadline.signal.addEventListener("abort", () => {
            if (!open) return;
            if (!deadline!.expired) { fail!(new Error("timeout: timer setup failed")); return; }
            expired = true;
            reportSignal(policy.signalNumber);
            const stopSignal = [19, 20, 21, 22].includes(policy.signalNumber)
              && (policy.signalNumber === 19 || !dispositions.has(policy.signalNumber));
            stopped = stopSignal;
            if (policy.signalNumber === 9 || policy.signalNumber !== 0 && !stopSignal && !dispositions.has(policy.signalNumber) && ![17, 18, 23, 28].includes(policy.signalNumber)) {
              killed = policy.signalNumber === 9;
              const exitCode = killed ? 137 : policy.preserveStatus ? 128 + policy.signalNumber : 124;
              void retire().then(() => finish!({ exitCode }), fail);
              return;
            }
            worker!.postMessage({ kind: "signal", number: policy.signalNumber });
            if (Number.isFinite(policy.killAfterMilliseconds)) {
              escalation = createDeadline(defaultSchedulerBinding, policy.killAfterMilliseconds, 2147483647);
              escalation.signal.addEventListener("abort", () => {
                if (!open) return;
                if (!escalation!.expired) { fail!(new Error("timeout: timer setup failed")); return; }
                killed = true;
                reportSignal(9);
                void retire().then(() => finish!({ exitCode: 137 }), fail);
              }, { once: true });
              escalation.start();
            }
          }, { once: true });
          deadline.start();
          worker!.postMessage({ kind: "start" });
        } else if (message.kind === "result") {
          if (stopped) return;
          const exitCode = killed ? 137 : expired && !policy.preserveStatus ? 124 : message.exitCode;
          void retire().then(() => finish!({ exitCode }), fail);
        } else if (message.kind === "failure") fail!(new Error(message.message));
        else if (message.kind === "call") {
          if (stopped) return;
          const operation = (async () => {
            try {
              const operationSignal = message.signalScope === undefined ? signal : scopeFor(message.signalScope).signal;
              operationSignal.throwIfAborted();
              let value: unknown;
              if (message.operation === "dispositions") {
                dispositions = new Map(message.args[0] as [number, "ignore" | "trap"][]);
              } else if (message.operation === "readStream.open") {
                if (!fs.readStream) throw new Error("Unsupported worker read stream");
                const reader = readBytes(fs.readStream(message.args[0] as string, { ...(message.args[1] as object), signal: operationSignal }), operationSignal);
                value = ++readerSequence;
                readers.set(readerSequence, reader);
              } else if (message.operation === "readStream.next" || message.operation === "readStream.close") {
                const id = message.args[0] as number;
                const reader = readers.get(id);
                if (!reader) throw new Error("Unknown worker read stream");
                if (message.operation === "readStream.next") value = await reader.next();
                else { await reader.return(undefined); readers.delete(id); }
              } else if (message.operation === "stdin") {
                iterator ??= readBytes({
                  [Symbol.asyncIterator]() {
                    const borrowed = context.stdin[Symbol.asyncIterator]();
                    // Only the pull belongs to this worker. Its retirement must
                    // not close the caller's stream or another pipeline reader.
                    return { next: () => borrowed.next() };
                  },
                }, signal)[Symbol.asyncIterator]();
                value = await iterator.next();
              } else if (message.operation === "stdout" || message.operation === "stderr") {
                const bytes = message.args[0];
                if (!(bytes instanceof Uint8Array)) throw new TypeError("Invalid worker output");
                await writeBytes(context[message.operation], bytes, signal);
              } else {
                if (!data.methods.includes(message.operation as typeof filesystemMethods[number])) throw new Error("Unsupported worker filesystem operation");
                const method = message.operation as typeof filesystemMethods[number];
                const callArgs = [...message.args];
                const final = callArgs.pop();
                callArgs.push({ ...(final as object), signal: operationSignal });
                value = await Reflect.apply(fs[method] as (...args: unknown[]) => unknown, fs, callArgs);
                if ((method === "stat" || method === "lstat") && value && typeof value === "object" && "identityScope" in value) {
                  const { identityScope, ...stat } = value;
                  let scope: number | undefined;
                  if (typeof identityScope === "object" && identityScope !== null || typeof identityScope === "symbol") {
                    scope = scopes.get(identityScope);
                    if (scope === undefined) { scope = scopes.size + 1; scopes.set(identityScope, scope); }
                  }
                  value = { stat, scope };
                }
              }
              if (open) worker!.postMessage({ kind: "reply", id: message.id, value });
            } catch (error) {
              if (open) worker!.postMessage({ kind: "reply", id: message.id, error: {
                message: error instanceof Error ? error.message : String(error),
                ...(error instanceof FsError ? { code: error.code, path: error.path, syscall: error.syscall, dest: error.dest } : {}),
              } });
            }
          })();
          admitted.add(operation);
          void operation.finally(() => admitted.delete(operation));
        }
      });
      return await result;
    } catch (error) {
      context.signal.throwIfAborted();
      await retire();
      await writeBytes(context.stderr, new TextEncoder().encode(`timeout: ${error instanceof Error ? error.message : String(error)}\n`), context.signal);
      return { exitCode: 125 };
    } finally { await retire(); }
  };
}
