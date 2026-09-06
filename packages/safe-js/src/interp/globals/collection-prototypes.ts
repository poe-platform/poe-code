import type { Budget } from "../budget.js";
import { accessorAdapter } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { installCollectionPrototype, materializeFunctionProperties, registerIntrinsicFunction } from "../object-model.js";
import { callMapMethod, mapMethodNames } from "../methods/map.js";
import { callSetMethod, setMethodNames } from "../methods/set.js";
import { createSandboxClosure, isSandboxMap, isSandboxSet, type SandboxClosure, type SandboxObject } from "../values.js";

export function installCollectionPrototypes(budget: Budget, mapConstructor: SandboxClosure, setConstructor: SandboxClosure): void {
  const mapMethods = Object.fromEntries([...mapMethodNames].map(name => [name, createSandboxClosure({
    guest: true, sandbox: true, name, length: Map.prototype[name].length,
    call: (args, context) => {
      const receiver = context?.thisValue;
      if (!isSandboxMap(receiver)) throw new TypeError(`Map.prototype.${name} requires a Map receiver.`);
      return callMapMethod(receiver, name, args, {
        budget,
        callClosure: (closure, values, _stack, thisValue) => invokeBuiltinClosure(closure, values, budget, context, thisValue)
      }, context?.stack ?? []);
    }
  })]));
  const setMethods = Object.fromEntries([...setMethodNames].filter(name => name !== "keys").map(name => [name, createSandboxClosure({
    guest: true, sandbox: true, name, length: Set.prototype[name].length,
    call: (args, context) => {
      const receiver = context?.thisValue;
      if (!isSandboxSet(receiver)) throw new TypeError(`Set.prototype.${name} requires a Set receiver.`);
      return callSetMethod(receiver, name, args, {
        budget,
        callClosure: (closure, values, _stack, thisValue) => invokeBuiltinClosure(closure, values, budget, context, thisValue)
      }, context?.stack ?? []);
    }
  })]));
  setMethods.keys = setMethods.values;
  const mapSize = createSandboxClosure({ guest: true, sandbox: true, name: "get size", length: 0,
    call: (_args, context) => {
      if (!isSandboxMap(context?.thisValue)) throw new TypeError("Map.prototype.size requires a Map receiver.");
      return context.thisValue.entries.size;
    }
  });
  const setSize = createSandboxClosure({ guest: true, sandbox: true, name: "get size", length: 0,
    call: (_args, context) => {
      if (!isSandboxSet(context?.thisValue)) throw new TypeError("Set.prototype.size requires a Set receiver.");
      return context.thisValue.values.size;
    }
  });
  for (const { name, constructor, methods, size, iterator } of [
    { name: "Map" as const, constructor: mapConstructor, methods: mapMethods, size: mapSize, iterator: mapMethods.entries },
    { name: "Set" as const, constructor: setConstructor, methods: setMethods, size: setSize, iterator: setMethods.values }
  ]) {
    const prototype = Object.create(null) as SandboxObject;
    const species = createSandboxClosure({ guest: true, sandbox: true, name: "get [Symbol.species]", length: 0,
      call: (_args, context) => context?.thisValue });
    Object.defineProperty(materializeFunctionProperties(constructor), "prototype", {value:prototype,writable:false});
    Object.defineProperty(materializeFunctionProperties(constructor), Symbol.species, {get:accessorAdapter(species,"get"),configurable:true});
    Object.defineProperty(prototype,"constructor",{value:constructor,writable:true,configurable:true});
    for (const [key, method] of Object.entries(methods))
      Object.defineProperty(prototype,key,{value:method,writable:true,configurable:true});
    Object.defineProperty(prototype,"size",{get:accessorAdapter(size,"get"),configurable:true});
    Object.defineProperty(prototype,Symbol.toStringTag,{value:name,configurable:true});
    Object.defineProperty(prototype,Symbol.iterator,{value:iterator,writable:true,configurable:true});
    installCollectionPrototype(budget,name,prototype,constructor);
    for (const method of new Set([...Object.values(methods),size,species])) registerIntrinsicFunction(budget,method);
  }
}
