import type { AgentHost } from "./agents.js";
import { isSandboxSharedArrayBuffer, receiveSharedArrayBufferStorage } from "../../src/interp/shared-array-buffer.js";
import { sandboxNumber } from "../../src/interp/string-coercion.js";
import { isSandboxClosure, isSandboxPromise } from "../../src/interp/values.js";
import {SourceModuleGraph, type SourceResolver} from "../../src/modules/source-graph.js";
import {createModuleEnvironment} from "../../src/modules/registry.js";
import {parseSourceModule} from "../../src/parse/source-module.js";
import { arrayBufferDetached, isSandboxArrayBuffer } from "../../src/interp/array-buffer.js";
import { parseEvalScript } from "../../src/parse/parser.js";
import { Budget, SandboxError, type BudgetOptions, type CompileOwner } from "../../src/interp/budget.js";
import { createBuiltinBindings } from "../../src/interp/globals.js";
import { interpret, Scope, type InterpreterValue } from "../../src/interp/interpreter.js";
import { getRealmGlobalObject } from "../../src/interp/intrinsics.js";
import { SandboxJobQueue } from "../../src/interp/jobs.js";
import { createIntrinsicObject, getSandboxPrototype, registerIntrinsicFunction, releaseObjectPrototype, setSandboxPrototype } from "../../src/interp/object-model.js";
import { createSandboxClosure, type SandboxClosure, type SandboxValue, type SandboxObject } from "../../src/interp/values.js";
import { SandboxPromiseRejectionTracker, withSandboxPromiseRejectionTracker } from "../../src/interp/promise-tracker.js";
import { sandboxString } from "../../src/interp/string-coercion.js";
import { runResources, type RunResources } from "../../src/interp/resources.js";

export type ScriptOutcome =
  | { status: "normal"; value: InterpreterValue }
  | { status: "throw"; phase: "parse" | "resolution" | "runtime"; error: unknown }
  | { status: "host-error"; error: unknown };

export type Test262Realm = {
  host: SandboxObject;
  unsupportedCapabilities: Set<"gc" | "source-resolution">;
  evaluate(source: string, nested?: boolean): Promise<ScriptOutcome>;
  evaluateModule(source: string, filename: string): Promise<ScriptOutcome>;
  settle(): Promise<ScriptOutcome>;
  dispose(): Promise<void>;
};

export function createTest262Realm(options: BudgetOptions = {}, onPrint?: (message: string) => void, owner?: CompileOwner, sources?: {resolver?: SourceResolver; filename: string}, agentOptions?: { agent: AgentHost; canBlock: boolean; onError?: (reason: unknown) => void }): Test262Realm {
  const budget = owner?.budget.forkRealm() ?? new Budget(options);
  const bindings = createBuiltinBindings({ budget, compileOwner: owner });
  const operation = budget.acquireCompileOwner(false, owner);
  const jobs = new SandboxJobQueue();
  const rejections = new SandboxPromiseRejectionTracker();
  const controller = new AbortController();
  const cleanups = new Set<() => Promise<void>>();
  let ownerFailure: { reason: unknown } | undefined;
  const resources: RunResources = {
    signal: controller.signal,
    canBlock: agentOptions?.canBlock,
    referenceReleases: new Set(),
    reportError(reason) {
      ownerFailure ??= { reason };
      agentOptions?.onError?.(ownerFailure.reason);
      controller.abort(ownerFailure.reason);
    },
    add(close) {
      cleanups.add(close);
      return () => { cleanups.delete(close); };
    }
  };
  const scope = new Scope(bindings).child({}, { globalEnvironment: true });
  const global = getRealmGlobalObject(budget);
  scope.declare("this", "const", global);
  const host = createIntrinsicObject();
  setSandboxPrototype(host, getSandboxPrototype(host, budget), budget);
  const children: Test262Realm[] = [];
  let disposal: Promise<void> | undefined;
  const modules = createModuleEnvironment(undefined,{budget,compileOwner:operation.owner});
  scope.moduleEnvironment = modules;
  scope.moduleId = sources?.filename;
  const graph = new SourceModuleGraph({scope,budget,jobs,compileOwner:operation.owner,signal:controller.signal,modules,
    resolver:async (specifier,referrer,context) => {
      const resolved = await sources?.resolver?.(specifier,referrer,context);
      if (resolved === undefined) realm.unsupportedCapabilities.add("source-resolution");
      return resolved;
    }});
  const realm: Test262Realm = {
    host,
    unsupportedCapabilities: new Set(),
    async evaluate(source: string, nested = false): Promise<ScriptOutcome> {
      if (disposal !== undefined) return { status: "host-error", error: new Error("Test262 realm is disposed") };
      if (ownerFailure !== undefined) return { status: "host-error", error: ownerFailure.reason };
      let parsed: ReturnType<typeof parseEvalScript>;
      try {
        parsed = parseEvalScript(source, {}, operation.owner);
      } catch (error) {
        return error instanceof SandboxError ? { status: "host-error", error }
          : { status: "throw", phase: "parse", error };
      }
      try {
        const result = await runResources.run(resources, () => withSandboxPromiseRejectionTracker(rejections, () => interpret({ type: "BlockStatement", body: parsed.node.body, span: parsed.node.span }, {
          budget, scope, jobs, signal: controller.signal, compileOwner: operation.owner,
          useScopeDirectly: true, nested, script: { strict: parsed.strict }
        })));
        return result.ok ? { status: "normal", value: result.returnValue }
          : { status: "host-error", error: result.error };
      } catch (error) {
        return error instanceof SandboxError || controller.signal.aborted ? { status: "host-error", error }
          : { status: "throw", phase: "runtime", error };
      }
    },
    async evaluateModule(source,filename): Promise<ScriptOutcome> {
      if (disposal !== undefined) return { status: "host-error", error: new Error("Test262 realm is disposed") };
      if (ownerFailure !== undefined) return { status: "host-error", error: ownerFailure.reason };
      try { parseSourceModule(source,filename,operation.owner); }
      catch (error) {
        return error instanceof SandboxError ? {status:"host-error",error}
          : {status:"throw",phase:error instanceof TypeError ? "resolution" : "parse",error};
      }
      let phase: "resolution" | "runtime" = "resolution";
      try {
        await runResources.run(resources, () => withSandboxPromiseRejectionTracker(rejections, () => graph.evaluateSource({id:filename,source}, () => {phase="runtime";})));
        return {status:"normal",value:undefined};
      } catch (error) {
        return error instanceof SandboxError || controller.signal.aborted ? {status:"host-error",error}
          : {status:"throw",phase,error};
      }
    },
    async settle(): Promise<ScriptOutcome> {
      try {
        await graph.settle();
        await jobs.drain();
        if (ownerFailure !== undefined) return { status: "host-error", error: ownerFailure.reason };
        const rejection = await rejections.findUnhandledRejection();
        if (rejection !== undefined) return { status: "throw", phase: "runtime", error: rejection.reason };
        for (const child of children) {
          const outcome = await child.settle();
          if (outcome.status !== "normal") return outcome;
        }
        return { status: "normal", value: undefined };
      } catch (error) { return { status: "host-error", error: ownerFailure === undefined ? error : ownerFailure.reason }; }
    },
    dispose(): Promise<void> {
      if (disposal !== undefined) return disposal;
      controller.abort(new Error("Test262 realm disposed"));
      for (const release of resources.referenceReleases) release();
      resources.referenceReleases.clear();
      disposal = Promise.allSettled([jobs.drain(), ...children.map(child => child.dispose()),
        ...[...cleanups].map(close => Promise.resolve().then(close))]).then(outcomes => {
        const errors = outcomes.flatMap(outcome => outcome.status === "rejected" ? [outcome.reason] : []);
        if (errors.length > 0) throw new AggregateError(errors, "Test262 realm cleanup failed");
      }).finally(() => {
        cleanups.clear();
        graph.close();
        releaseObjectPrototype(budget);
        operation.release();
      });
      return disposal;
    }
  };
  if (agentOptions) {
    const agent = createIntrinsicObject();
    setSandboxPrototype(agent, getSandboxPrototype(agent, budget), budget);
    const transport = agentOptions.agent;
    const methods = {
      sleep: { length: 1, call: async (args, context) => {
        const duration = await sandboxNumber(args[0], budget, context);
        await new Promise<void>(resolve => {
          const finish = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, Math.max(0, duration));
          controller.signal.addEventListener("abort", finish, {once: true});
          if (controller.signal.aborted) finish();
        });
        controller.signal.throwIfAborted();
        return undefined;
      } },
      monotonicNow: { length: 0, call: () => performance.now() },
      ...(transport.start ? { start: { length: 1, call: async (args, context) => {
        await transport.start!(await sandboxString(args[0], budget, context)); return undefined;
      } } } : {}),
      ...(transport.broadcast ? { broadcast: { length: 2, call: async (args, context) => {
        if (!isSandboxSharedArrayBuffer(args[0])) throw new TypeError("Expected shared storage");
        const id = typeof args[1] === "bigint" ? args[1] : (await sandboxNumber(args[1], budget, context)) | 0;
        await transport.broadcast!(args[0], id); return undefined;
      } } } : {}),
      ...(transport.getReport ? { getReport: { length: 0, call: () => transport.getReport!() } } : {}),
      ...(transport.receiveBroadcast ? { receiveBroadcast: { length: 1, call: async (args, context) => {
        if (!isSandboxClosure(args[0])) throw new TypeError("Expected a broadcast callback");
        const message = await transport.receiveBroadcast!();
        const result = await args[0].call([receiveSharedArrayBufferStorage(message.buffer, budget), message.id], context);
        if (isSandboxPromise(result)) {
          const check = async () => {
            const settlement = await realm.settle();
            if (settlement.status !== "normal") resources.reportError?.(settlement.error);
          };
          void result.promise.then(check, check).catch(reason => resources.reportError?.(reason));
        }
        return undefined;
      } } } : {}),
      ...(transport.report ? { report: { length: 1, call: async (args, context) => {
        transport.report!(await sandboxString(args[0], budget, context)); return undefined;
      } } } : {}),
      ...(transport.leaving ? { leaving: { length: 0, call: () => { transport.leaving!(); return undefined; } } } : {})
    } satisfies Record<string, Pick<Parameters<typeof createSandboxClosure>[0], "length" | "call">>;
    for (const [name, method] of Object.entries(methods)) {
      const closure = createSandboxClosure({ ...method, name, guest: true, sandbox: true });
      registerIntrinsicFunction(budget, closure);
      Object.defineProperty(agent, name, { value: closure, writable: true, configurable: true });
    }
    host.agent = agent;
    // The upstream helper's microtask polling fallback prevents worker message
    // delivery. Give conformance an explicitly owned host timer instead.
    const timers = new Map<number, { timer: ReturnType<typeof setTimeout>; callback: SandboxClosure; args: SandboxValue[] }>();
    let nextTimer = 0;
    budget.setRetainedValues(timers, () => [...timers.values()].flatMap(entry => [entry.callback, ...entry.args]));
    cleanups.add(async () => {
      for (const entry of timers.values()) clearTimeout(entry.timer);
      timers.clear();
      budget.setRetainedValues(timers, undefined);
      budget.setRetainedDataUsage(timers, 0);
    });
    const schedule = createSandboxClosure({ name: "setTimeout", length: 2, guest: true, sandbox: true,
      call: async (args, context) => {
        const callback = args[0];
        if (!isSandboxClosure(callback)) throw new TypeError("Test262 timer requires a callable callback");
        const duration = await sandboxNumber(args[1], budget, context);
        controller.signal.throwIfAborted();
        const id = ++nextTimer;
        const callbackArgs = args.slice(2);
        budget.setRetainedDataUsage(timers, timers.size + 1);
        const timer = setTimeout(() => {
          void jobs.run(async () => {
            timers.delete(id);
            budget.setRetainedDataUsage(timers, timers.size);
            if (controller.signal.aborted) return;
            await runResources.run(resources, () => withSandboxPromiseRejectionTracker(rejections,
              async () => callback.call(callbackArgs, context)));
          }).catch(reason => resources.reportError?.(reason));
        }, Math.max(0, duration));
        timers.set(id, { timer, callback, args: callbackArgs });
        return id;
      }
    });
    registerIntrinsicFunction(budget, schedule);
    Object.defineProperty(global, "setTimeout", { value: schedule, writable: true, configurable: true });
  }
  const evalScript = createSandboxClosure({ guest: true, sandbox: true, name: "evalScript", length: 1,
    call: async (args, context) => {
      const source = await sandboxString(args[0], budget, context);
      const outcome = await realm.evaluate(source, true);
      if (outcome.status !== "normal") throw outcome.error;
      return outcome.value;
    }
  });
  const createRealm = createSandboxClosure({ guest: true, sandbox: true, name: "createRealm", length: 0,
    call: async () => {
      const child = createTest262Realm(options, onPrint, operation.owner, sources, agentOptions);
      children.push(child);
      child.unsupportedCapabilities = realm.unsupportedCapabilities;
      const initialized = await child.evaluate("", true);
      if (initialized.status !== "normal") throw initialized.error;
      return child.host;
    }
  });
  const print = createSandboxClosure({ guest: true, sandbox: true, name: "print", length: 1,
    call: async (args, context) => {
      const message = await sandboxString(args[0], budget, context);
      onPrint?.(message);
      return undefined;
    }
  });
  const detachArrayBuffer = createSandboxClosure({ guest: true, sandbox: true, name: "detachArrayBuffer", length: 1,
    call: args => {
      const buffer = args[0];
      if (!isSandboxArrayBuffer(buffer)) throw new TypeError("Expected an ArrayBuffer");
      if (args[1] !== undefined) throw new TypeError("ArrayBuffer detach key mismatch");
      if (!arrayBufferDetached(buffer)) structuredClone(buffer, { transfer: [buffer] });
      return undefined;
    }
  });
  const gc = createSandboxClosure({ guest: true, sandbox: true, name: "gc", length: 0,
    call: () => {
      realm.unsupportedCapabilities.add("gc");
      throw new Error("Test262 host garbage collection capability is unavailable");
    }
  });
  for (const closure of [evalScript, createRealm, print, detachArrayBuffer, gc]) registerIntrinsicFunction(budget, closure);
  Object.assign(host, { global, evalScript, createRealm, detachArrayBuffer, gc });
  Object.defineProperties(global, {
    $262: { value: host, writable: true, configurable: true },
    print: { value: print, writable: true, configurable: true }
  });
  return realm;
}
