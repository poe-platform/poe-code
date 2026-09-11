import type { Budget } from "../budget.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { finalizationRegistryStates } from "../finalization-registry-state.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { createOwnedFinalizationRegistryState } from "../owned-finalization-registry.js";
import { canHoldWeakTarget } from "../weak-reference.js";
import { allocateProducedSandboxValue, createSandboxClosure, isSandboxClosure, measureSandboxData, type SandboxClosure, type SandboxValue } from "../values.js";

export function createFinalizationRegistryGlobal(budget: Budget): SandboxClosure {
  const prototype = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest:true,sandbox:true,name:"FinalizationRegistry",length:1,
    call:() => { throw new TypeError("FinalizationRegistry requires new."); },
    construct:async ([callback],context) => {
      if (!isSandboxClosure(callback)) throw new TypeError("Finalization cleanup must be callable.");
      let selected: SandboxValue;
      const release = retainValues(budget, () => [callback,selected]);
      try {
        const newTarget = context?.newTarget ?? constructor;
        selected = await sandboxGetProperty(newTarget,"prototype",newTarget,budget,context);
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(newTarget,"FinalizationRegistry",prototype);
        const result = Object.create(null) as Record<string,SandboxValue>;
        setSandboxPrototype(result,selected,budget);
        const state = createOwnedFinalizationRegistryState(callback,budget,context);
        finalizationRegistryStates.set(result,{state,callback});
        return allocateProducedSandboxValue(result,budget);
      } finally { release(); }
    }
  });
  const register = createSandboxClosure({
    guest:true,sandbox:true,name:"register",length:2,
    call:([target,heldValue,token],context) => {
      const receiver = context?.thisValue;
      const entry = receiver !== null && typeof receiver === "object" ? finalizationRegistryStates.get(receiver) : undefined;
      if (entry === undefined) throw new TypeError("Incompatible FinalizationRegistry receiver.");
      if (!canHoldWeakTarget(target,budget)) throw new TypeError("Invalid finalization target.");
      if (Object.is(target,heldValue)) throw new TypeError("Finalization target and held value must differ.");
      if (token !== undefined && !canHoldWeakTarget(token,budget)) throw new TypeError("Invalid unregister token.");
      budget.allocateCollectionEntries(entry.state.cells.size + 1);
      entry.state.register(target,heldValue,token);
      createDataCheckpoint(budget,context)(receiver,3 + (budget.limits.dataSize === undefined ? 0 : measureSandboxData([heldValue])));
      return undefined;
    }
  });
  const unregister = createSandboxClosure({
    guest:true,sandbox:true,name:"unregister",length:1,
    call:([token],context) => {
      const receiver = context?.thisValue;
      const entry = receiver !== null && typeof receiver === "object" ? finalizationRegistryStates.get(receiver) : undefined;
      if (entry === undefined) throw new TypeError("Incompatible FinalizationRegistry receiver.");
      if (!canHoldWeakTarget(token,budget)) throw new TypeError("Invalid unregister token.");
      budget.visitNode(entry.state.cells.size);
      return entry.state.unregister(token);
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor),"prototype",{value:prototype,writable:false});
  Object.defineProperties(prototype,{
    constructor:{value:constructor,writable:true,configurable:true},
    register:{value:register,writable:true,configurable:true},
    unregister:{value:unregister,writable:true,configurable:true},
    [Symbol.toStringTag]:{value:"FinalizationRegistry",configurable:true}
  });
  setSandboxPrototype(prototype,getSandboxPrototype(Object.create(null),budget));
  registerBuiltinIdentities(budget,{FinalizationRegistry:constructor});
  for (const method of [constructor,register,unregister]) registerIntrinsicFunction(budget,method);
  registerIntrinsicObject(budget,prototype);
  return constructor;
}
