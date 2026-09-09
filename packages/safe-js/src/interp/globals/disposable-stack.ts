import { isFatalSandboxError, type Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { disposableStackStates, type DisposableStackState, type DisposableResource } from "../disposable-stack.js";
import { createSubsetErrorValue, createThrowCompletion } from "../exceptions.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { wellKnownSymbols } from "../symbols.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";

export function createDisposableStackGlobal(budget: Budget): SandboxClosure {
  const prototype: SandboxObject = createIntrinsicObject();
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  const constructor: SandboxClosure = createSandboxClosure({
    guest: true, sandbox: true, name: "DisposableStack", length: 0,
    call: () => { throw new TypeError("DisposableStack requires new."); },
    construct: async (_args, context) => {
      const target = context?.newTarget ?? constructor;
      const candidate = await read(target, "prototype", context);
      const parent = candidate !== null && typeof candidate === "object" ? candidate
        : getFunctionRealmPrototype(target, "DisposableStack", prototype);
      const instance: SandboxObject = Object.create(null);
      disposableStackStates.set(instance, { disposed: false, active: false, resources: [] });
      setSandboxPrototype(instance, parent !== null && typeof parent === "object" ? parent : prototype, budget);
      createDataCheckpoint(budget, context)(instance, 0, true);
      return instance;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "DisposableStack", configurable: true },
    disposed: { get: accessorAdapter(createSandboxClosure({
      guest: true, sandbox: true, name: "get disposed", length: 0,
      call: (_args, context) => requireState(context?.thisValue).disposed
    }), "get"), configurable: true }
  });
  for (const name of ["use", "adopt", "defer", "move", "dispose"] as const) {
    const method = createSandboxClosure({
      guest: true, sandbox: true, name, length: name === "adopt" ? 2 : name === "move" || name === "dispose" ? 0 : 1,
      call: async (args, context) => {
        const receiver = context?.thisValue;
        const state = requireState(receiver);
        if (name === "dispose") {
          if (state.disposed) return undefined;
          state.disposed = true;
          state.active = true;
          let failed = false;
          let failure: SandboxValue;
          let current: DisposableResource | undefined;
          const release = retainValues(budget, () => [receiver, failure,
            ...(current === undefined ? [] : [current.method, current.receiver, ...current.args])]);
          try {
            while ((current = state.resources.pop()) !== undefined) {
              budget.visitNode();
              try {
                await invokeBuiltinClosure(current.method, current.args, budget, context, current.receiver);
              } catch (error) {
                if (isFatalSandboxError(error)) throw error;
                const thrown = createThrowCompletion(error, budget, context?.stack ?? []).value;
                if (failed) {
                  const combined = createSubsetErrorValue("SuppressedError", undefined, context?.stack ?? [], budget);
                  Object.defineProperties(combined, {
                    error: { value: thrown, writable: true, configurable: true },
                    suppressed: { value: failure, writable: true, configurable: true }
                  });
                  failure = combined;
                } else { failed = true; failure = thrown; }
              }
            }
            if (failed) throw failure;
            return undefined;
          } finally { state.active = false; release(); }
        }
        if (state.disposed) throw new ReferenceError("DisposableStack is already disposed.");
        if (name === "move") {
          const moved: SandboxObject = Object.create(null);
          disposableStackStates.set(moved, { disposed: false, active: false, resources: state.resources });
          setSandboxPrototype(moved, prototype, budget);
          state.resources = [];
          state.disposed = true;
          createDataCheckpoint(budget, context)(moved, 0, true);
          return moved;
        }
        const value = args[0];
        if (name === "use" && (value === null || value === undefined)) return value;
        if (name === "use" && typeof value !== "object") throw new TypeError("Disposable resource must be an object.");
        const resources = state.resources;
        const method = name === "use" ? await read(value, wellKnownSymbols.dispose, context) : args[name === "adopt" ? 1 : 0];
        if (!isSandboxClosure(method)) throw new TypeError("Disposer must be callable.");
        resources.push({ method, receiver: name === "use" ? value : undefined, args: name === "adopt" ? [value] : [] });
        createDataCheckpoint(budget, context)(receiver, 0, true);
        return name === "defer" ? undefined : value;
      }
    });
    Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true });
    if (name === "dispose") Object.defineProperty(prototype, wellKnownSymbols.dispose, { value: method, writable: true, configurable: true });
  }
  registerBuiltinIdentities(budget, { DisposableStack: constructor });
  registerIntrinsicFunction(budget, constructor);
  registerIntrinsicObject(budget, prototype);
  return constructor;

  async function read(value: SandboxValue, key: PropertyKey, context?: SandboxCallContext): Promise<SandboxValue> {
    if (context?.getProperty !== undefined) return context.getProperty(value, key);
    const descriptor = getSandboxPropertyDescriptor(value, key, budget);
    return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
  }
}

function requireState(receiver: SandboxValue): DisposableStackState {
  const state = receiver !== null && typeof receiver === "object" ? disposableStackStates.get(receiver) : undefined;
  if (state === undefined) throw new TypeError("DisposableStack method requires a branded receiver.");
  return state;
}
