import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { advanceAsyncCleanup, asyncCleanupStates, asyncDisposableStackStates, type AsyncCleanupState, type AsyncDisposableStackState } from "../async-disposable-stack.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { createThrowCompletion } from "../exceptions.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { createPendingPromiseCapability } from "../promise.js";
import { wellKnownSymbols } from "../symbols.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";

export function createAsyncDisposableStackGlobal(budget: Budget): SandboxClosure {
  const prototype: SandboxObject = createIntrinsicObject();
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "AsyncDisposableStack", length: 0,
    call: () => {throw new TypeError("AsyncDisposableStack requires new.");},
    construct: async (_args, context) => {
      const target = context?.newTarget ?? constructor;
      const candidate = await read(target, "prototype", context);
      const parent = candidate !== null && typeof candidate === "object" ? candidate
        : getFunctionRealmPrototype(target, "AsyncDisposableStack", prototype);
      const instance: SandboxObject = Object.create(null);
      asyncDisposableStackStates.set(instance, {disposed: false, resources: []});
      setSandboxPrototype(instance, parent !== null && typeof parent === "object" ? parent : prototype, budget);
      createDataCheckpoint(budget, context)(instance, 0, true);
      return instance;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", {value: prototype, writable: false});
  Object.defineProperties(prototype, {
    constructor: {value: constructor, writable: true, configurable: true},
    [Symbol.toStringTag]: {value: "AsyncDisposableStack", configurable: true},
    disposed: {get: accessorAdapter(createSandboxClosure({
      guest: true, sandbox: true, name: "get disposed", length: 0,
      call: (_args, context) => requireState(context?.thisValue).disposed
    }), "get"), configurable: true}
  });
  const dispose = createSandboxClosure({
    guest: true, sandbox: true, name: "disposeAsync", length: 0,
    call: (_args, context) => {
      let completePrefix!: () => void;
      let failPrefix!: (error: unknown) => void;
      const prefix = new Promise<void>((resolve, reject) => {completePrefix = resolve; failPrefix = reject;});
      const capability = createPendingPromiseCapability(budget, context, prefix);
      void (async () => {
        try {
          const state = requireState(context?.thisValue);
          if (state.disposed) {await capability.resolve.call([], context); return;}
          state.disposed = true;
          const cleanup: AsyncCleanupState = {resources: state.resources,
            capability: {promise: capability.promise, resolve: capability.resolve, reject: capability.reject}, phase: "running",
            failed: false, failure: undefined, needsAwait: false, hasAwaited: false, generation: 0};
          state.resources = [];
          asyncCleanupStates.set(cleanup, cleanup);
          await advanceAsyncCleanup(cleanup, budget, context);
        } catch (error) {
          await capability.reject.call([createThrowCompletion(error, budget, context?.stack ?? []).value], context);
        }
      })().then(completePrefix, failPrefix);
      return capability.promise;
    }
  });
  Object.defineProperty(prototype, "disposeAsync", {value: dispose, writable: true, configurable: true});
  Object.defineProperty(prototype, wellKnownSymbols.asyncDispose, {value: dispose, writable: true, configurable: true});
  for (const name of ["use", "adopt", "defer", "move"] as const) {
    Object.defineProperty(prototype, name, {writable: true, configurable: true, value: createSandboxClosure({
      guest: true, sandbox: true, name, length: name === "adopt" ? 2 : name === "move" ? 0 : 1,
      call: async (args, context) => {
        const receiver = context?.thisValue;
        const state = requireState(receiver);
        if (state.disposed) throw new ReferenceError("AsyncDisposableStack is already disposed.");
        if (name === "move") {
          const moved: SandboxObject = Object.create(null);
          asyncDisposableStackStates.set(moved, {disposed: false, resources: state.resources});
          setSandboxPrototype(moved, prototype, budget);
          state.resources = [];
          state.disposed = true;
          createDataCheckpoint(budget, context)(moved, 0, true);
          return moved;
        }
        const value = args[0];
        const resources = state.resources;
        let method: SandboxValue;
        let syncFallback = false;
        const nullish = name === "use" && (value === null || value === undefined);
        if (name === "use" && !nullish) {
          if (typeof value !== "object") throw new TypeError("Disposable resource must be an object.");
          method = await read(value, wellKnownSymbols.asyncDispose, context);
          if (method === null || method === undefined) {
            syncFallback = true;
            method = await read(value, wellKnownSymbols.dispose, context);
          }
        } else if (!nullish) method = args[name === "adopt" ? 1 : 0];
        if (!nullish && !isSandboxClosure(method)) throw new TypeError("Disposer must be callable.");
        resources.push({method: method as SandboxClosure | undefined, receiver: name === "use" && !nullish ? value : undefined,
          args: name === "adopt" ? [value] : [], syncFallback});
        createDataCheckpoint(budget, context)(receiver, 0, true);
        return name === "defer" ? undefined : value;
      }
    })});
  }
  registerBuiltinIdentities(budget, {AsyncDisposableStack: constructor});
  registerIntrinsicFunction(budget, constructor);
  registerIntrinsicObject(budget, prototype);
  return constructor;

  async function read(value: SandboxValue, key: PropertyKey, context?: SandboxCallContext): Promise<SandboxValue> {
    if (context?.getProperty !== undefined) return context.getProperty(value, key);
    const descriptor = getSandboxPropertyDescriptor(value, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
  }
}

function requireState(receiver: SandboxValue): AsyncDisposableStackState {
  const state = receiver !== null && typeof receiver === "object" ? asyncDisposableStackStates.get(receiver) : undefined;
  if (state === undefined) throw new TypeError("AsyncDisposableStack method requires a branded receiver.");
  return state;
}
