import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { keepJobTarget } from "../jobs.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, type SandboxClosure, type SandboxValue } from "../values.js";
import { canHoldWeakTarget, createWeakReferenceState, weakReferenceStates } from "../weak-reference.js";

export function createWeakRefGlobal(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "WeakRef", length: 1,
    call: () => { throw new TypeError("WeakRef requires new."); },
    construct: async ([target], context) => {
      if (!canHoldWeakTarget(target, budget)) throw new TypeError("Invalid WeakRef target.");
      let selected: SandboxValue;
      const release = retainValues(budget, () => [target, selected]);
      try {
        const newTarget = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(newTarget, "prototype", newTarget, budget, context);
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(newTarget, "WeakRef", prototype);
        const result = Object.create(null) as Record<string, SandboxValue>;
        setSandboxPrototype(result, selected, budget);
        const reference = createWeakReferenceState(target as Extract<SandboxValue, object | symbol>);
        weakReferenceStates.set(result, reference);
        keepJobTarget(target as object | symbol, budget);
        return allocateProducedSandboxValue(result, budget);
      } finally { release(); }
    }
  });
  const deref = createSandboxClosure({
    guest: true, sandbox: true, name: "deref", length: 0,
    call: (_args, context) => {
      const receiver = context?.thisValue;
      const state = receiver !== null && typeof receiver === "object" ? weakReferenceStates.get(receiver) : undefined;
      if (state === undefined) throw new TypeError("Incompatible WeakRef receiver.");
      const target = state.deref();
      if (target !== undefined) keepJobTarget(target, budget);
      return target;
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    deref: { value: deref, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "WeakRef", configurable: true }
  });
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  registerBuiltinIdentities(budget, { WeakRef: constructor });
  registerIntrinsicFunction(budget, constructor);
  registerIntrinsicFunction(budget, deref);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
