import { denyGuestStringCompilation } from "./interp/string-compilation.js";
import { arrayBufferDetached, arrayBufferLength, arrayBufferOptions, isSandboxArrayBuffer } from "./interp/array-buffer.js";
import {hashParsedAst} from "./parse/hash.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { types } from "node:util";
import { guestProxyStates } from "./interp/guest-proxy.js";
import { callGuestProxy } from "./interp/guest-proxy-call.js";
import { sandboxGetProperty } from "./interp/guest-proxy-get.js";
import { invokeBuiltinClosure } from "./interp/builtin-call.js";
import { Budget, SandboxError } from "./interp/budget.js";
import { CompileScope } from "./interp/regex/compile-guard.js";
import { createBuiltinBindings } from "./interp/globals.js";
import { getRealmGlobalObject } from "./interp/intrinsics.js";
import { releaseObjectPrototype } from "./interp/object-model.js";
import { interpret, Scope, type InterpreterResult } from "./interp/interpreter.js";
import { attachExecutionControl, SandboxJobQueue, runAsyncPrefix, suspendJob, type ExecutionControl } from "./interp/jobs.js";
import { withCancellationSignal, awaitSandboxValue } from "./interp/cancel.js";
import { enterRunningState } from "./interp/running-state.js";
import { retainValues, runResources, type RunResources } from "./interp/resources.js";
import {
  createSandboxPromiseRejectionTracker,
  withSandboxPromiseRejectionTracker
} from "./interp/promise-tracker.js";
import {
  copyHostValueToSandbox,
  wrapCallerInjectedBindings,
  type CallerInjectedBinding,
  type HostBridgeOptions,
  type RealmBridge
} from "./interp/host-bridge.js";
import {
  createLiveHostObject,
  hostObjectGuestRoots,
  createGuestReference,
  exportHostCapability,
  readGuestReference,
  readGuestCallback,
  registerGuestCallback,
  revokeGuestCallback,
  revokeHostObject,
  revokeGuestReference,
  type GuestReference,
  type HostObjectDefinition,
  type HostObject
} from "./interp/host-capabilities.js";
import {
  deepCopyFromSandbox,
  isSandboxClosure,
  isSandboxPromise,
  measureSandboxData,
  reconcileCompiledValues,
  type SandboxClosure,
  type SandboxCallContext,
  type SandboxValue
} from "./interp/values.js";
import {
  getExtensionSetup,
  readDataRecord,
  readStringList,
  type CallbackOptions,
  type CallbackInvocation,
  type ExtensionContext,
  type ExtensionExports,
  type HostOperation,
  type SafeJSExtension
} from "./extensions.js";
import {SourceModuleGraph, type SourceResolver} from "./modules/source-graph.js";
import { createModuleEnvironment, resolveModuleImports, type ModuleRegistry } from "./modules/registry.js";
import { parseExecutableModule } from "./parse/parser.js";
import { createEvalSource } from "./parse/dynamic-source.js";
import { createReplayableRandom } from "./random.js";
import { hashSource } from "./parse/hash.js";
import { describeThrownValue } from "./error/shape.js";
import { encodeReplayData } from "./snapshot/replay-data.js";
import type { ConsoleSink } from "./interp/globals/console-json.js";
import type { RunClock, RunOptions, RunResult } from "./run.js";

export type RealmLimits = {
  extensions?: number;
  hostObjects?: number;
  callbacks?: number;
  guestReferences?: number;
  cleanups?: number;
  nestedEvaluations?: number;
};
export type RealmOptions = {
  stringCompilation?: "allow" | "deny";
  classicScripts?: boolean;
  classicScriptErrors?: "fatal" | "report";
  callbackScheduling?: "after-prefix";
  sourceResolver?: SourceResolver;
  clock?: RunClock;
  bindings?: Record<string, CallerInjectedBinding>;
  modules?: ModuleRegistry;
  extensions?: readonly SafeJSExtension[];
  builtinOverrides?: { console?: string };
  grants?: readonly string[];
  budget?: Budget;
  signal?: AbortSignal;
  sink?: ConsoleSink;
  randomSeed?: number;
  limits?: RealmLimits;
};
export type RealmResult =
  | (Omit<Extract<InterpreterResult, { ok: true }>, "snapshot" | "returnValue"> & {
      returnValue?: unknown;
    })
  | (Omit<Extract<InterpreterResult, { ok: false }>, "snapshot"> & { recoverable?: true });
export type SafeJSRealm = ExecutionControl & {
  readonly stringCompilation: "allow" | "deny";
  readonly classicScriptErrors: "fatal" | "report";
  readonly extensions: readonly SafeJSExtension["manifest"][];
  evaluate(source: string, options?: { filename?: string; sourceType?: "module" }): Promise<RealmResult>;
  startCallback(callback: unknown, options?: CallbackOptions): CallbackInvocation;
  invokeCallback(callback: unknown, options?: CallbackOptions): Promise<unknown>;
  releaseCallback(callback: unknown): void;
  releaseGuestReference(reference: unknown): void;
  close(): Promise<void>;
};

type HostPhase = {
  active: boolean;
  extension?: SafeJSExtension;
  evaluating: boolean;
  pending: Set<Promise<void>>;
  failure?: { reason: unknown };
};
type Callback = (...args: readonly unknown[]) => Promise<unknown>;

class RealmState {
  readonly budget: Budget;
  readonly lease: ReturnType<Budget["acquireCompileOwner"]>;
  readonly compilation: CompileScope;
  readonly controller = new AbortController();
  readonly phase = new AsyncLocalStorage<HostPhase>();
  readonly queue: SandboxJobQueue;
  readonly tracker = createSandboxPromiseRejectionTracker();
  readonly bridge: RealmBridge;
  readonly limits: Required<RealmLimits>;
  readonly extensions: readonly SafeJSExtension[];
  readonly consoleExtension?: string;
  readonly cleanups: Array<() => void | Promise<void>> = [];
  readonly referenceReleases = new Set<() => void>();
  readonly resources: RunResources;
  readonly callbacks = new Map<Callback, SandboxClosure>();
  readonly pendingCallbacks = new Set<{ closure: SandboxClosure; prefixComplete: boolean; promise?: Promise<unknown> }>();
  readonly pendingWork = new Set<Promise<unknown>>();
  releaseReconciliation?: () => void;
  readonly callbackCache = new WeakMap<SandboxClosure, Callback>();
  readonly hostObjects = new Set<HostObject>();
  readonly guestReferences = new Map<GuestReference, [SandboxValue]>();
  readonly retainedOperations = new WeakMap<
    HostOperation,
    { from: number; extension: SafeJSExtension }
  >();
  readonly nestedOperations = new WeakMap<HostOperation, SafeJSExtension>();
  readonly convertedModules = new Map<string, Record<string, SandboxValue>>();
  readonly nativeConversions = { seen: new WeakMap<object, SandboxValue>() };
  readonly modules: Record<string, Record<string, CallerInjectedBinding>>;
  readonly globals: Record<string, CallerInjectedBinding>;
  readonly builtinBindings: ReturnType<typeof createBuiltinBindings>;
  scope?: Scope;
  sourceGraph?: SourceModuleGraph;
  sourceModuleHash?: string;
  active?: Promise<unknown>;
  disposal?: Promise<void>;
  closed = false;
  initialized = false;
  nestedDepth = 0;
  failure?: { reason: unknown };

  constructor(readonly options: RealmOptions, queue = new SandboxJobQueue()) {
    if (options.classicScripts !== undefined && typeof options.classicScripts !== "boolean")
      throw new TypeError("Realm classicScripts must be a boolean.");
    this.queue = queue;
    const limitInput = readDataRecord(options.limits ?? {}, "Realm limits");
    this.limits = {
      extensions: 32,
      hostObjects: 1024,
      callbacks: 1024,
      guestReferences: 1024,
      cleanups: 1024,
      nestedEvaluations: 16
    };
    for (const [name, value] of Object.entries(limitInput)) {
      if (!Object.hasOwn(this.limits, name) || !Number.isSafeInteger(value) || Number(value) < 1)
        throw new TypeError("Realm limits must be positive safe integers with supported names.");
      this.limits[name as keyof RealmLimits] = Number(value);
    }
    if (
      options.extensions !== undefined &&
      (!Array.isArray(options.extensions) || types.isProxy(options.extensions))
    )
      throw new TypeError("Extensions must be a registration array.");
    const registrations = options.extensions ?? [];
    const extensions: SafeJSExtension[] = [];
    if (registrations.length > this.limits.extensions)
      throw new RangeError("Realm extension limit exceeded.");
    for (let index = 0; index < registrations.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(registrations, String(index));
      if (descriptor === undefined || !("value" in descriptor))
        throw new TypeError("Extension registrations require data properties, not accessors.");
      extensions.push(descriptor.value);
    }
    if (Reflect.ownKeys(registrations).length !== extensions.length + 1)
      throw new TypeError("Extension registrations have unsupported fields.");
    this.extensions = Object.freeze(extensions);
    if (this.extensions.length > this.limits.extensions)
      throw new RangeError("Realm extension limit exceeded.");
    this.globals = readDataRecord(options.bindings ?? {}, "Realm bindings") as Record<
      string,
      CallerInjectedBinding
    >;
    if (options.classicScripts && ["this", "globalThis"].some(name => Object.hasOwn(this.globals, name)))
      throw new TypeError("Classic Script receiver bindings cannot be replaced.");
    this.modules = readModules(options.modules);
    const grants = new Set(readStringList(options.grants ?? [], "Realm grants"));
    for (const extension of this.extensions) getExtensionSetup(extension);
    const overrides = readDataRecord(options.builtinOverrides === undefined ? {} : options.builtinOverrides, "Builtin overrides");
    for (const [name, extensionName] of Object.entries(overrides)) {
      if (name !== "console" || typeof extensionName !== "string" || extensionName.length === 0 || extensionName.length > 256)
        throw new TypeError("Builtin overrides only supports console with a nonempty extension name.");
      if (!this.extensions.some(extension => extension.manifest.name === extensionName && extension.manifest.globals?.includes(name)))
        throw new TypeError("Console override requires a registered extension declaring console.");
      this.consoleExtension = extensionName;
    }
    this.budget = options.budget ?? new Budget({ maxCallDepth: 1000 });
    this.lease = this.budget.acquireRealmOwner();
    this.compilation = new CompileScope(this.lease.owner);
    this.bridge = {
      owner: this,
      assertActive: this.assertOpen,
      wrapCallback: this.wrapCallback,
      captureArguments: this.captureArguments,
      invoke: this.invokeHost,
      awaitResult: (operation) => this.nestedOperations.has(operation)
    };
    this.resources = {
      signal: this.controller.signal,
      referenceReleases: this.referenceReleases,
      add: this.onCleanup,
      reportError: reason => this.poison(reason)
    };
    try {
      this.builtinBindings = createBuiltinBindings({
        budget: this.budget,
        compileOwner: this.lease.owner,
        sink: options.sink,
        clock: options.clock,
        random: createReplayableRandom({ seed: options.randomSeed }).next
      });
      const names = new Set<string>();
      const globals = new Set([
        ...Object.keys(this.builtinBindings).filter(name => name !== "console" || this.consoleExtension === undefined),
        ...Object.keys(this.globals)
      ]);
      const modules = new Map(
        Object.entries(this.modules).map(([name, exports]) => [name, new Set(Object.keys(exports))])
      );
      for (const extension of this.extensions) {
        const manifest = extension.manifest;
        if (options.classicScripts && manifest.globals?.some(name => name === "this" || name === "globalThis"))
          throw new TypeError("Classic Script receiver bindings cannot be replaced.");
        if (names.has(manifest.name))
          throw new TypeError(`Duplicate extension '${manifest.name}'.`);
        names.add(manifest.name);
        for (const capability of manifest.capabilities ?? []) {
          if (!grants.has(capability))
            throw new TypeError(`Missing grant '${capability}' for extension '${manifest.name}'.`);
        }
        for (const name of manifest.globals ?? []) {
          if (name === "console" && this.consoleExtension !== undefined && manifest.name !== this.consoleExtension)
            throw new TypeError(`Conflicting global 'console': replacement is authorized only for '${this.consoleExtension}'.`);
          if (globals.has(name)) throw new TypeError(`Conflicting global '${name}'.`);
          globals.add(name);
        }
        for (const [name, exports] of Object.entries(manifest.modules ?? {})) {
          const occupied = modules.get(name) ?? new Set<string>();
          for (const key of exports) {
            if (occupied.has(key)) throw new TypeError(`Conflicting export '${name}.${key}'.`);
            occupied.add(key);
          }
          modules.set(name, occupied);
        }
      }
      this.controller.signal.addEventListener("abort", () => this.queue.interrupt(this.controller.signal.reason), { once: true });
      options.signal?.addEventListener("abort", this.abort, { once: true });
      if (options.signal?.aborted) this.abort();
      this.budget.setRetainedValues(this, this.retainedRoots);
      this.tracker.onFatalRejection((error) => this.poison(error));
    } catch (error) {
      releaseObjectPrototype(this.budget);
      this.compilation.dispose();
      this.lease.release();
      throw error;
    }
  }

  bridgeOptions = (): HostBridgeOptions => ({
    budget: this.budget,
    compileOwner: this.lease.owner,
    signal: this.controller.signal,
    realm: this.bridge
  });

  retainedRoots = (): SandboxValue[] => [
    ...Array.from(this.hostObjects).flatMap(hostObjectGuestRoots),
    ...this.callbacks.values(),
    ...Array.from(this.pendingCallbacks, (pending) => pending.closure),
    ...this.guestReferences.values()
  ];

  captureArguments: RealmBridge["captureArguments"] = (operation, args, copy) => {
    const from = this.retainedOperations.get(operation)?.from ?? args.length;
    const values = copy(args.slice(0, from));
    const captured: GuestReference[] = [];
    const rollback = () => {
      for (const reference of captured) {
        revokeGuestReference(reference, this);
        this.guestReferences.delete(reference);
      }
    };
    try {
      for (const value of args.slice(from)) {
        this.checkCollection(
          this.guestReferences.size + 1,
          this.limits.guestReferences,
          "guest reference"
        );
        const root: [SandboxValue] = [value];
        const reference = createGuestReference(root, this, this.assertOpen);
        this.guestReferences.set(reference, root);
        captured.push(reference);
        values.push(reference);
      }
      if (captured.length > 0)
        this.budget.reconcileDataUsage(
          measureSandboxData([...(this.scope?.retainedDataRoots() ?? []), ...this.retainedRoots(), ...this.budget.retainedValues()])
        );
      return { args: values, rollback };
    } catch (error) {
      rollback();
      if (error instanceof SandboxError) this.poison(error);
      throw error;
    }
  };

  createArrayBufferReference = (buffer: ArrayBuffer): GuestReference => {
    this.assertOpen();
    if (
      !isSandboxArrayBuffer(buffer) ||
      arrayBufferDetached(buffer) ||
      arrayBufferOptions(buffer) !== undefined ||
      Reflect.ownKeys(buffer).length !== 0
    )
      throw new TypeError(
        "Live buffer references require a fixed, attached, plain ArrayBuffer without metadata.",
      );
    let reference: GuestReference | undefined;
    try {
      this.budget.allocateArrayLength(arrayBufferLength(buffer));
      this.checkCollection(
        this.guestReferences.size + 1,
        this.limits.guestReferences,
        "guest reference",
      );
      const root: [SandboxValue] = [buffer];
      reference = createGuestReference(root, this, this.assertOpen);
      this.guestReferences.set(reference, root);
      this.budget.reconcileDataUsage(
        measureSandboxData([
          ...(this.scope?.retainedDataRoots() ?? []),
          ...this.retainedRoots(),
          ...this.budget.retainedValues(),
        ]),
      );
      return reference;
    } catch (error) {
      if (reference !== undefined) {
        revokeGuestReference(reference, this);
        this.guestReferences.delete(reference);
      }
      if (error instanceof SandboxError) this.poison(error);
      throw error;
    }
  };

  releaseGuestReference = (reference: unknown): void => {
    readGuestReference(reference, this);
    revokeGuestReference(reference as GuestReference, this);
    this.guestReferences.delete(reference as GuestReference);
    if (this.active === undefined)
      reconcileCompiledValues(
        this.budget,
        [...(this.scope?.retainedDataRoots() ?? []), ...this.retainedRoots()],
        this.compilation
      );
  };

  assertOpen = (): void => {
    if (this.failure !== undefined) throw this.failure.reason;
    if (this.closed) throw new Error("SafeJS realm is closed; capabilities are revoked.");
    this.controller.signal.throwIfAborted();
  };

  abort = (): void => {
    this.poison(this.options.signal?.reason ?? new SandboxError("aborted"));
    void this.close().catch(() => undefined);
  };

  poison(reason: unknown): void {
    this.failure ??= { reason };
    this.controller.abort(reason);
    if (this.active === undefined)
      queueMicrotask(() => {
        void this.dispose().catch(() => undefined);
      });
  }

  trackWork<Result>(pending: Promise<Result>): Promise<Result> {
    this.pendingWork.add(pending);
    void pending.then(
      () => { this.pendingWork.delete(pending); },
      () => { this.pendingWork.delete(pending); }
    );
    return pending;
  }

  reconcileWhenIdle(): void {
    if (this.closed || this.active !== undefined || this.pendingCallbacks.size > 0) return;
    this.releaseReconciliation?.();
    this.releaseReconciliation = undefined;
    try {
      reconcileCompiledValues(
        this.budget,
        [...(this.scope?.retainedDataRoots() ?? []), ...this.retainedRoots()],
        this.compilation
      );
    } catch (error) {
      this.poison(error);
      void this.dispose().catch(() => undefined);
      throw error;
    }
  }

  chargeWork = (units = 1): void => {
    this.assertOpen();
    if (!Number.isSafeInteger(units) || units < 0)
      throw new TypeError("Work charges must be non-negative safe integers.");
    try {
      for (let index = 0; index < units; index++) this.budget.visitNode();
    } catch (error) {
      this.poison(error);
      throw error;
    }
  };

  onCleanup = (cleanup: () => void | Promise<void>): (() => void) => {
    this.assertOpen();
    if (typeof cleanup !== "function") throw new TypeError("Cleanup must be a function.");
    this.checkCollection(this.cleanups.length + 1, this.limits.cleanups, "cleanup");
    // Each registration has its own identity even when callbacks are reused.
    const registration = () => cleanup();
    this.cleanups.push(registration);
    return () => {
      const index = this.cleanups.indexOf(registration);
      if (index !== -1) this.cleanups.splice(index,1);
    };
  };

  checkCollection(count: number, limit: number, name: string): void {
    this.assertOpen();
    try {
      this.budget.allocateCollectionEntries(count);
    } catch (error) {
      this.poison(error);
      throw error;
    }
    if (count > limit) throw new RangeError(`Realm ${name} limit exceeded.`);
  }

  invokeHost = (operation: HostOperation, call: () => unknown): unknown => {
    this.assertOpen();
    const phase: HostPhase = {
      active: true,
      extension: this.nestedOperations.get(operation),
      evaluating: false,
      pending: new Set()
    };
    return this.phase.run(phase, () => {
      try {
        const result = call();
        if (types.isPromise(result) || phase.pending.size > 0 || phase.failure !== undefined) {
          return Promise.resolve(result)
            .then(
              async (value) => {
                await Promise.allSettled(phase.pending);
                if (phase.failure !== undefined) throw phase.failure.reason;
                this.assertOpen();
                return value;
              },
              async (error) => {
                if (error instanceof SandboxError || phase.pending.size > 0) this.poison(error);
                await Promise.allSettled(phase.pending);
                throw error;
              }
            )
            .finally(() => {
              phase.active = false;
            });
        }
        this.assertOpen();
        phase.active = false;
        return result;
      } catch (error) {
        phase.active = false;
        if (error instanceof SandboxError) this.poison(error);
        if (phase.pending.size > 0) {
          this.poison(error);
          return Promise.allSettled(phase.pending).then(() => {
            throw error;
          });
        }
        throw error;
      }
    });
  };

  importValue(value: unknown): SandboxValue {
    return copyHostValueToSandbox(
      value,
      [],
      this.bridgeOptions(),
      { seen: new WeakMap() },
      "<realm>"
    );
  }

  exportValue(value: SandboxValue): unknown {
    return deepCopyFromSandbox(value, {
      compilation: this.compilation,
      wrapClosure: this.wrapCallback,
      unwrapHostObject: (object) => exportHostCapability(object, this)
    });
  }

  createHostObject = (definition: HostObjectDefinition): HostObject => {
    this.checkCollection(this.hostObjects.size + 1, this.limits.hostObjects, "host object");
    const object = createLiveHostObject(definition, {
      owner: this,
      assertActive: this.assertOpen,
      chargeWork: this.chargeWork,
      chargeGuestData: (units) => this.budget.chargeDataUsage(units),
      checkLength: (length) => this.budget.allocateArrayLength(length),
      checkString: (value) => { this.budget.allocateString(value); },
      checkTemporaryDataSize: (size) => {
        const temporary = {};
        try {
          this.budget.setRetainedDataUsage(temporary, size);
        } finally {
          this.budget.setRetainedDataUsage(temporary, 0);
        }
      },
      read: (operation, validate) => {
        const value = this.invokeHost(operation, operation);
        if (types.isPromise(value)) {
          void Promise.resolve(value).catch(() => undefined);
          throw new TypeError("Live property operations must be synchronous.");
        }
        return this.importValue(validate === undefined ? value : validate(value));
      },
      write: (operation, value) => {
        const result = this.invokeHost(operation, () => operation(this.exportValue(value)));
        if (types.isPromise(result)) {
          void Promise.resolve(result).catch(() => undefined);
          throw new TypeError("Live property setters must be synchronous.");
        }
      },
      method: (operation) => {
        const value = copyHostValueToSandbox(
          operation,
          [],
          this.bridgeOptions(),
          this.nativeConversions,
          "<host-method>"
        );
        if (!isSandboxClosure(value)) throw new TypeError("Invalid host method.");
        return value;
      }
    });
    this.hostObjects.add(object);
    try {
      this.budget.chargeDataUsage(1);
    } catch (error) {
      this.poison(error);
      throw error;
    }
    return object;
  };

  wrapCallback = (closure: SandboxClosure): Callback => {
    this.assertOpen();
    const existing = this.callbackCache.get(closure);
    if (existing !== undefined && this.callbacks.has(existing)) return existing;
    this.checkCollection(this.callbacks.size + 1, this.limits.callbacks, "callback");
    const invokeCallback = this.invokeCallback;
    const callback = function (this: unknown, ...args: readonly unknown[]) {
      return invokeCallback(callback, { args, thisValue: this });
    };
    this.callbacks.set(callback, closure);
    this.callbackCache.set(closure, callback);
    registerGuestCallback(callback, {
      owner: this,
      closure,
      assertActive: () => {
        this.assertOpen();
        if (!this.callbacks.has(callback)) throw new TypeError("Guest callback is revoked.");
      }
    });
    try {
      this.budget.reconcileDataUsage(
        measureSandboxData([...(this.scope?.retainedDataRoots() ?? []), ...this.retainedRoots(), ...this.budget.retainedValues()])
      );
    } catch (error) {
      this.poison(error);
      throw error;
    }
    return callback;
  };

  releaseCallback = (callback: unknown): void => {
    readGuestCallback(callback, this);
    revokeGuestCallback(callback as object, this);
    this.callbacks.delete(callback as Callback);
    if (this.active === undefined)
      reconcileCompiledValues(
        this.budget,
        [...(this.scope?.retainedDataRoots() ?? []), ...this.retainedRoots()],
        this.compilation
      );
  };

  startCallback = (callback: unknown, options: CallbackOptions = {}): CallbackInvocation => {
    let complete!: () => void;
    let fail!: (reason: unknown) => void;
    const synchronous = new Promise<void>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    const result = this.executeCallback(callback, options, complete);
    void result.catch(fail);
    void synchronous.catch(() => undefined);
    return Object.freeze({ synchronous, result });
  };

  invokeCallback = this.executeCallback.bind(this);

  private async executeCallback(
    callback: unknown,
    options: CallbackOptions = {},
    completeSynchronous?: () => void
  ): Promise<unknown> {
    if ((this.closed || this.failure !== undefined) && this.options.callbackScheduling !== "after-prefix")
      await this.dispose();
    this.assertOpen();
    const closure = readGuestCallback(callback, this);
    this.checkCollection(this.pendingCallbacks.size + 1, this.limits.callbacks, "pending callback");
    const scheduled = this.options.callbackScheduling === "after-prefix";
    const record: { closure: SandboxClosure; prefixComplete: boolean; promise?: Promise<unknown> } = {
      closure, prefixComplete: false
    };
    this.pendingCallbacks.add(record);
    if (scheduled) this.releaseReconciliation ??= this.budget.deferReconciliation();
    const rejectionOwner = scheduled ? this.tracker.startOperation() : undefined;
    const invoke = async () => {
      this.assertOpen();
      readGuestCallback(callback, this);
      const leave = enterRunningState(closure);
      const leaveCall = this.budget.enterCall();
      try {
        const values = this.importValue([
          options.thisValue,
          [...(options.args ?? [])]
        ]) as SandboxValue[];
        const callerContext: SandboxCallContext = {
          thisValue: values[0],
          compilation: this.compilation,
          stack: [],
          getProperty: (object, key) => sandboxGetProperty(object, key, object, this.budget, bridge)
        };
        const bridge: SandboxCallContext = {
          ...callerContext,
          invokeClosure: (target, args, receiver, construct, newTarget) =>
            invokeBuiltinClosure(target, args, this.budget, callerContext, receiver, construct, newTarget)
        };
        const value = await (guestProxyStates.has(closure)
          ? callGuestProxy(closure, values[1] as SandboxValue[], this.budget, bridge, values[0])
          : closure.call(values[1] as SandboxValue[], {
            thisValue: values[0], compilation: this.compilation, stack: []
          }));
        const settlement = awaitSandboxValue(value, this.controller.signal, this.budget);
        void settlement.catch(() => undefined);
        if (isSandboxPromise(value) && value.synchronousPrefix !== undefined)
          await value.synchronousPrefix;
        this.assertOpen();
        record.prefixComplete = true;
        completeSynchronous?.();
        const settled = await suspendJob(settlement);
        return this.exportValue(settled);
      } finally {
        leaveCall();
        leave();
      }
    };
    try {
      const active = this.active !== undefined || (scheduled && this.phase.getStore()?.active === true);
      const execute = () => this.tracker.withOperation(rejectionOwner, () =>
        withSandboxPromiseRejectionTracker(this.tracker, () =>
          runResources.run(this.resources, () =>
            withCancellationSignal(this.controller.signal, () =>
              active && this.phase.getStore()?.active
                ? runAsyncPrefix(invoke, completeSynchronous === undefined && this.phase.getStore()?.extension !== undefined)
                : this.queue.run(invoke)
            )
          )
        )
      );
      const pending = scheduled && this.sourceGraph !== undefined
        ? this.sourceGraph.withoutImportGroup(execute) : execute();
      record.promise = scheduled ? this.trackWork(pending) : active ? pending : this.perform(() => pending);
      const result = await record.promise;
      if (scheduled) {
        await this.checkUnhandledRejection(rejectionOwner);
        this.assertOpen();
      }
      return result;
    } catch (error) {
      if (scheduled || error instanceof SandboxError) this.poison(error);
      if (scheduled) void this.dispose().catch(() => undefined);
      throw error;
    } finally {
      this.tracker.finishOperation(rejectionOwner);
      this.pendingCallbacks.delete(record);
      if (scheduled) this.reconcileWhenIdle();
      else if (!this.closed && this.active === undefined)
        reconcileCompiledValues(
          this.budget,
          [...(this.scope?.retainedDataRoots() ?? []), ...this.retainedRoots()],
          this.compilation
        );
    }
  }

  initialize(): void {
    if (this.initialized) return;
    this.assertOpen();
    this.initialized = true;
    for (const extension of this.extensions) {
      const context: ExtensionContext = Object.freeze({
        signal: this.controller.signal,
        // Detachment is internal, not an extension capability.
        onCleanup: cleanup => { this.onCleanup(cleanup); },
        chargeWork: this.chargeWork,
        createHostObject: this.createHostObject,
        createArrayBufferReference: buffer => {
          this.assertOpen();
          if (!extension.manifest.capabilities?.includes("array-buffer:share"))
            throw new TypeError("Live buffers require the array-buffer:share grant.");
          return this.createArrayBufferReference(buffer);
        },
        startCallback: this.startCallback,
        invokeCallback: this.invokeCallback,
        releaseCallback: this.releaseCallback,
        releaseGuestReference: this.releaseGuestReference,
        retainGuestArguments: <Operation extends HostOperation>(
          operation: Operation,
          from: number
        ): Operation => {
          this.assertOpen();
          if (!extension.manifest.capabilities?.includes("guest:retain"))
            throw new TypeError("Retaining arguments requires the guest:retain grant.");
          if (typeof operation !== "function")
            throw new TypeError("Retained operation must be a function.");
          if (!Number.isSafeInteger(from) || from < 0)
            throw new TypeError("Argument index must be a non-negative safe integer.");
          if (this.scope !== undefined)
            throw new TypeError("Retained operations must be registered during setup.");
          const previous = this.retainedOperations.get(operation);
          if (
            previous !== undefined &&
            (previous.extension !== extension || previous.from !== from)
          )
            throw new TypeError("Conflicting retained operation declaration.");
          this.retainedOperations.set(operation, { extension, from });
          return operation;
        },
        nestedOperation: <Operation extends HostOperation>(operation: Operation): Operation => {
          this.assertOpen();
          if (!extension.manifest.capabilities?.includes("source:nested"))
            throw new TypeError("Nested source requires the source:nested grant.");
          if (typeof operation !== "function")
            throw new TypeError("Nested operation must be a function.");
          if (this.scope !== undefined)
            throw new TypeError("Nested operations must be registered during setup.");
          const owner = this.nestedOperations.get(operation);
          if (owner !== undefined && owner !== extension)
            throw new TypeError("Nested operation already belongs to another extension.");
          this.nestedOperations.set(operation, extension);
          return operation;
        },
        evaluateNested: (source) => {
          const phase = this.phase.getStore();
          if (
            !extension.manifest.capabilities?.includes("source:nested") ||
            !phase?.active ||
            phase.extension !== extension ||
            phase.evaluating
          ) {
            const error = new SandboxError("reentry");
            this.poison(error);
            const rejected = Promise.reject<void>(error);
            void rejected.catch(() => undefined);
            return rejected;
          }
          const pending = this.evaluateNested(source, extension);
          phase.pending.add(pending);
          void pending.then(
            () => {
              phase.pending.delete(pending);
            },
            (reason) => {
              phase.pending.delete(pending);
              phase.failure ??= { reason };
            }
          );
          return pending;
        }
      });
      const output = getExtensionSetup(extension)(context);
      if (types.isPromise(output)) {
        void Promise.resolve(output).catch(() => undefined);
        throw new TypeError("Extension setup must be synchronous.");
      }
      const exports = readDataRecord(output, "Extension exports");
      if (Object.keys(exports).some((key) => key !== "globals" && key !== "modules"))
        throw new TypeError("Unknown extension export field.");
      const globals = readDataRecord(
        exports.globals ?? {},
        "Extension globals"
      ) as ExtensionExports["globals"] & {};
      const modules = readModules(exports.modules as ModuleRegistry | undefined);
      assertNames(Object.keys(globals), extension.manifest.globals ?? [], "global");
      if (extension.manifest.name === this.consoleExtension && !this.hostObjects.has(globals.console as HostObject))
        throw new TypeError("Console replacement must be a host object created in this realm.");
      assertNames(Object.keys(modules), Object.keys(extension.manifest.modules ?? {}), "module");
      for (const [name, values] of Object.entries(modules)) {
        assertNames(Object.keys(values), extension.manifest.modules?.[name] ?? [], "module export");
        this.modules[name] ??= Object.create(null) as Record<string, CallerInjectedBinding>;
        Object.assign(this.modules[name], values);
      }
      Object.assign(this.globals, globals);
    }
    const bindings = wrapCallerInjectedBindings(this.globals, this.bridgeOptions());
    this.scope = new Scope(this.builtinBindings, undefined, undefined, { chargeData: false }).child(
      bindings,
      this.options.classicScripts ? { globalEnvironment: true } : { functionBoundary: true }
    );
    if (this.options.classicScripts)
      this.scope.declare("this", "const", getRealmGlobalObject(this.budget));
    if (this.options.stringCompilation === "deny") denyGuestStringCompilation(this.scope);
  }

  async evaluateRaw(
    source: string,
    filename = "<realm>",
    nested = false,
    sourceType?: "module",
    reportUnhandledThrows = false
  ): Promise<InterpreterResult> {
    this.assertOpen();
    if (typeof source !== "string") throw new TypeError("Realm source must be a string.");
    if (sourceType === "module") {
      const prepare = () => {
        this.initialize();
        this.sourceGraph ??= new SourceModuleGraph({
          resolver:this.options.sourceResolver ?? (() => undefined), scope:this.scope!,
          modules:createModuleEnvironment(this.modules,{...this.bridgeOptions(),wrappedModules:this.convertedModules}),
          budget:this.budget, compilation:this.compilation, signal:this.controller.signal,
          jobs:this.queue, assertActive:this.assertOpen, surfaceUnhandledThrows:true,
          serializePreparation: this.options.callbackScheduling === "after-prefix"
        });
      };
      const scheduled = this.options.callbackScheduling === "after-prefix";
      if (scheduled) await this.queue.run(prepare);
      else prepare();
      const graph = this.sourceGraph!;
      const before = graph.stats.nodeVisits;
      const evaluate = async () => {
        const namespace = await graph.evaluateSource({id:filename,source}, module => {
          this.sourceModuleHash = hashParsedAst(module);
        });
        if (!scheduled) await graph.settle();
        return namespace;
      };
      const namespace = scheduled ? await graph.withImportGroup(evaluate) : await evaluate();
      return {ok:true,returnValue:namespace,snapshot:{bindings:{}},stats:{nodeVisits:graph.stats.nodeVisits - before,currentDataSize:this.budget.currentDataSize,peakDataSize:this.budget.peakDataSize}};
    }
    const script = this.options.classicScripts ? createEvalSource(source, {}, this.lease.owner, filename) : undefined;
    const releaseSource = script ? retainValues(this.budget, () => [script.source]) : undefined;
    try {
      if (script) this.budget.chargeDataUsage(measureSandboxData([script.source]));
      const module = script?.node ?? parseExecutableModule(source, filename, this.lease.owner);
      this.initialize();
      const moduleEnvironment = createModuleEnvironment(this.modules, {...this.bridgeOptions(),wrappedModules:this.convertedModules});
      const imports = script ? {} : resolveModuleImports(module, this.modules, {
        environment: moduleEnvironment,
        ...this.bridgeOptions(),
        wrappedModules: this.convertedModules
      });
      this.scope!.moduleEnvironment = moduleEnvironment;
      for (const [name, value] of Object.entries(imports)) {
        const binding = this.scope!.lookup(name);
        if (!binding.found) this.scope!.declare(name, "const", value);
        else if (binding.value !== value) throw new TypeError(`Conflicting import '${name}'.`);
      }
      const result = await interpret(
        {
          type: "BlockStatement",
          body: module.body.filter((statement) => statement.type !== "ImportDeclaration"),
          span: module.span
        },
        {
          ...(script ? { script: { strict: script.strict } } : {}),
          scope: this.scope,
          useScopeDirectly: true,
          budget: this.budget,
          compilation: this.compilation,
          signal: this.controller.signal,
          surfaceUnhandledThrows: true,
          reportUnhandledThrows: script !== undefined && reportUnhandledThrows,
          jobs: this.queue,
          nested,
          assertActive: this.assertOpen
        }
      );
      this.assertOpen();
      return result;
    } finally {
      releaseSource?.();
    }
  }

  evaluateNested = async (source: string, extension: SafeJSExtension): Promise<void> => {
    this.assertOpen();
    const phase = this.phase.getStore();
    if (
      !phase?.active ||
      phase.extension !== extension ||
      phase.evaluating ||
      (this.active === undefined && !(this.options.callbackScheduling === "after-prefix" && this.pendingCallbacks.size > 0))
    )
      throw new SandboxError("reentry");
    const leave = this.budget.enterCall();
    phase.evaluating = true;
    try {
      if (++this.nestedDepth > this.limits.nestedEvaluations) {
        const error = new SandboxError({
          budget: "callDepth",
          current: this.nestedDepth,
          limit: this.limits.nestedEvaluations
        });
        this.poison(error);
        throw error;
      }
      const result = await this.evaluateRaw(source, "<nested>", true);
      if (!result.ok) throw new Error(result.error.message);
    } finally {
      this.nestedDepth--;
      phase.evaluating = false;
      leave();
    }
  };

  evaluate = async (source: string, options: { filename?: string; sourceType?: "module" } = {}): Promise<RealmResult> =>
    this.perform<RealmResult>(async () => {
      const scheduled = this.options.callbackScheduling === "after-prefix";
      const reportUnhandledThrows = options.sourceType !== "module" && this.options.classicScriptErrors === "report";
      const result = scheduled && options.sourceType !== "module"
        ? await this.queue.run(() => this.evaluateRaw(source, options.filename, true, undefined, reportUnhandledThrows))
        : await this.evaluateRaw(source, options.filename, false, options.sourceType, reportUnhandledThrows);
      if (!result.ok) {
        const recoverable = reportUnhandledThrows && result.error.code === "UNCAUGHT_EXCEPTION";
        if (!scheduled && !recoverable) await this.dispose();
        return { ok: false, error: result.error, stats: result.stats, ...(recoverable ? { recoverable: true } : {}) };
      }
      return { ok: true, returnValue: this.exportValue(result.returnValue), stats: result.stats };
    }, result => !result.ok && !result.recoverable);

  async checkUnhandledRejection(owner?: object): Promise<void> {
    const unhandled = await this.tracker.findUnhandledRejection(owner);
    if (unhandled !== undefined) {
      const error = new Error(
        `Unhandled guest promise rejection: ${describeThrownValue(unhandled.reason)}`
      );
      error.name = "UnhandledRejectionError";
      throw error;
    }
  }

  async perform<Result>(task: () => Promise<Result>, failed?: (result: Result) => boolean): Promise<Result> {
    if ((this.closed || this.failure !== undefined) && this.options.callbackScheduling !== "after-prefix")
      await this.dispose();
    this.assertOpen();
    if (this.active !== undefined) throw new SandboxError("reentry");
    const scheduled = this.options.callbackScheduling === "after-prefix";
    if (scheduled && (this.phase.getStore()?.active || [...this.pendingCallbacks].some(record => !record.prefixComplete)))
      throw new SandboxError("reentry");
    const rejectionOwner = scheduled ? this.tracker.startOperation() : undefined;
    const pending = Promise.resolve().then(() =>
      this.tracker.withOperation(rejectionOwner, () =>
        withSandboxPromiseRejectionTracker(this.tracker, () =>
          runResources.run(this.resources, () =>
            withCancellationSignal(this.controller.signal, task)
          )
        )
      )
    );
    this.active = pending;
    if (scheduled) this.trackWork(pending);
    try {
      const result = await pending;
      if (scheduled && failed?.(result)) {
        this.closed = true;
        this.controller.abort(new Error("SafeJS source evaluation failed."));
        await this.dispose();
        return result;
      }
      if (scheduled) this.assertOpen();
      await this.queue.drain();
      await this.checkUnhandledRejection(rejectionOwner);
      if (this.failure !== undefined) throw this.failure.reason;
      if (scheduled) this.assertOpen();
      if (!this.closed)
        reconcileCompiledValues(
          this.budget,
          [...(this.scope?.retainedDataRoots() ?? []), ...this.retainedRoots()],
          this.compilation
        );
      return result;
    } catch (error) {
      const reason = this.failure === undefined ? error : this.failure.reason;
      this.poison(reason);
      try {
        await this.dispose();
      } catch (cleanup) {
        throw new AggregateError([reason, cleanup], "Realm execution and cleanup failed.");
      }
      throw reason;
    } finally {
      this.tracker.finishOperation(rejectionOwner);
      if (this.active === pending) this.active = undefined;
      if (scheduled) this.reconcileWhenIdle();
    }
  }

  close = (): Promise<void> => {
    this.closed = true;
    this.controller.abort(new Error("SafeJS realm is closed."));
    if (this.options.callbackScheduling === "after-prefix") {
      const disposal = this.dispose();
      if (this.phase.getStore()?.active) {
        void disposal.catch(() => undefined);
        return Promise.reject(new SandboxError("reentry"));
      }
      return disposal;
    }
    if (this.phase.getStore()?.active) return this.dispose();
    return Promise.allSettled([
      this.active,
      ...Array.from(this.pendingCallbacks, (pending) => pending.promise)
    ]).then(() => this.dispose());
  };

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;
    this.closed = true;
    this.controller.abort(new Error("SafeJS realm is closed."));
    this.options.signal?.removeEventListener("abort", this.abort);
    if (this.options.callbackScheduling === "after-prefix") {
      this.disposal = Promise.resolve().then(async () => {
        while (this.pendingWork.size > 0) await Promise.allSettled([...this.pendingWork]);
        await this.sourceGraph?.settle();
        await this.queue.settle();
        this.releaseReconciliation?.();
        this.releaseReconciliation = undefined;
        await this.releaseResources();
      }).finally(() => this.queue.finish());
      return this.disposal;
    }
    this.disposal = this.releaseResources().finally(() => this.queue.finish());
    return this.disposal;
  }

  async releaseResources(): Promise<void> {
    for (const callback of this.callbacks.keys()) revokeGuestCallback(callback, this);
    this.callbacks.clear();
    for (const object of this.hostObjects) revokeHostObject(object, this);
    this.hostObjects.clear();
    for (const reference of this.guestReferences.keys()) revokeGuestReference(reference, this);
    this.guestReferences.clear();
    for (const release of this.referenceReleases) release();
    this.referenceReleases.clear();
    this.budget.setRetainedValues(this, undefined);
    this.sourceGraph?.close();
    releaseObjectPrototype(this.budget);
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    this.scope = undefined;
    this.convertedModules.clear();
    for (const key of Object.keys(this.globals)) delete this.globals[key];
    for (const key of Object.keys(this.modules)) delete this.modules[key];
    for (const key of Object.keys(this.builtinBindings))
      Reflect.deleteProperty(this.builtinBindings, key);
    this.nativeConversions.seen = new WeakMap();
    reconcileCompiledValues(this.budget, [], this.compilation);
    this.compilation.dispose();
    this.lease.release();
    if (errors.length > 0) throw new AggregateError(errors, "Realm cleanup failed.");
  }
}

function readModules(
  input: ModuleRegistry | undefined
): Record<string, Record<string, CallerInjectedBinding>> {
  const entries = (value: unknown, label: string): Array<[string, unknown]> => {
    if (types.isMap(value) && !types.isProxy(value)) {
      const result = [...Map.prototype.entries.call(value)] as Array<[string, unknown]>;
      if (
        result.length > 4096 ||
        result.some(([key]) => typeof key !== "string" || key.length === 0)
      )
        throw new TypeError(`${label} requires bounded string keys.`);
      return result;
    }
    return Object.entries(readDataRecord(value, label));
  };
  const modules = Object.create(null) as Record<string, Record<string, CallerInjectedBinding>>;
  for (const [name, exports] of entries(input ?? {}, "Module registry")) {
    const exported = Object.create(null) as Record<string, CallerInjectedBinding>;
    for (const [key, value] of entries(exports, "Module exports"))
      exported[key] = value as CallerInjectedBinding;
    modules[name] = exported;
  }
  return modules;
}

function assertNames(actual: readonly string[], expected: readonly string[], label: string): void {
  if (actual.length !== expected.length || actual.some((name) => !expected.includes(name)))
    throw new TypeError(`Extension ${label} names do not match its manifest.`);
}

export function createRealm(options: RealmOptions = {}): SafeJSRealm {
  const state = new RealmState(readRealmOptions(options));
  return Object.freeze(attachExecutionControl({
    stringCompilation: state.options.stringCompilation ?? "allow",
    classicScriptErrors: state.options.classicScriptErrors ?? "fatal",
    extensions: Object.freeze(state.extensions.map((extension) => extension.manifest)),
    evaluate: state.evaluate,
    startCallback: state.startCallback,
    invokeCallback: state.invokeCallback,
    releaseCallback: state.releaseCallback,
    releaseGuestReference: state.releaseGuestReference,
    close: state.close
  }, state.queue));
}

export async function runWithExtensions(source: string, options: RunOptions, jobs?: SandboxJobQueue): Promise<RunResult> {
  if (
    options.snapshot !== undefined ||
    options.snapshotBackend !== undefined ||
    options.snapshotPath !== undefined ||
    options.entryPointArgs !== undefined
  )
    throw new TypeError(
      "Live extension runs do not support snapshots or entryPointArgs; use a persistent realm."
    );
  const state = new RealmState(readRealmOptions(options, true), jobs);
  try {
    const result = await state.perform(() => state.evaluateRaw(source, options.filename, false, options.sourceType));
    if (result.ok && options.sourceType !== "module") encodeReplayData(result.returnValue);
    return {
      ...result,
      snapshot: {
        version: 1,
        sourceHash: state.sourceModuleHash ?? hashSource(source),
        bindings: {},
        replayError: "Live realm state cannot be serialized or replayed."
      }
    };
  } catch (error) {
    if (state.disposal === undefined) {
      try {
        await state.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Realm execution and cleanup failed.");
      }
    }
    throw error;
  } finally {
    if (state.disposal === undefined) await state.close();
  }
}

function readRealmOptions(value: unknown, oneShot = false): RealmOptions {
  const options = readDataRecord(value, "Realm options");
  const supported = new Set([
    "bindings",
    "modules",
    "sourceResolver",
    "extensions",
    "builtinOverrides",
    "grants",
    "budget",
    "signal",
    "sink",
    "randomSeed",
    "clock",
    "limits"
  ]);
  if (!oneShot) supported.add("stringCompilation");
  if (!oneShot) supported.add("classicScripts");
  if (!oneShot) supported.add("classicScriptErrors");
  if (!oneShot) supported.add("callbackScheduling");
  for (const [key, entry] of Object.entries(options)) {
    if (supported.has(key) || (oneShot && (key === "filename" || key === "sourceType" || entry === undefined))) continue;
    throw new TypeError(`Unsupported ${oneShot ? "extension-run" : "realm"} option '${key}'.`);
  }
  if (options.callbackScheduling !== undefined && options.callbackScheduling !== "after-prefix")
    throw new TypeError("Realm callbackScheduling must be 'after-prefix'.");
  if (options.stringCompilation !== undefined && options.stringCompilation !== "allow" && options.stringCompilation !== "deny")
    throw new TypeError("Realm stringCompilation must be 'allow' or 'deny'.");
  if (options.classicScriptErrors !== undefined && options.classicScriptErrors !== "fatal" && options.classicScriptErrors !== "report")
    throw new TypeError("Realm classicScriptErrors must be 'fatal' or 'report'.");
  if (options.classicScriptErrors === "report" && options.classicScripts !== true)
    throw new TypeError("Reporting classic Script errors requires classicScripts:true.");
  return options as RealmOptions;
}
