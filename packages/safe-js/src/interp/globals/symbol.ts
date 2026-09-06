import type { Budget } from "../budget.js";
import { sandboxString } from "../string-coercion.js";
import { createSandboxClosure } from "../values.js";
import { wellKnownSymbols } from "../symbols.js";
import { primitiveReceiver } from "../boxed.js";
import { installBoxedPrototype } from "../object-model.js";
import { accessorAdapter } from "../accessors.js";

const registries = new WeakMap<Budget, Map<string, symbol>>();

export function createSymbolGlobal(budget: Budget) {
  let registry = registries.get(budget);
  if (registry === undefined) {
    registry = new Map();
    registries.set(budget, registry);
  }
  const entries = registry;
  const prototype = Object.create(null);
  const valueOf = createSandboxClosure({ sandbox: true, name: "valueOf", length: 0,
    call: (_args, context) => primitiveReceiver(context?.thisValue, "symbol") });
  Object.defineProperties(prototype, {
    valueOf: { value: valueOf, writable: true, configurable: true },
    toString: { value: createSandboxClosure({ sandbox: true, name: "toString", length: 0,
      call: (_args, context) => budget.allocateString(String(primitiveReceiver(context?.thisValue, "symbol"))) }), writable: true, configurable: true },
    description: { get: accessorAdapter(createSandboxClosure({ sandbox: true, name: "get description", length: 0,
      call: (_args, context) => {
        const value = primitiveReceiver(context?.thisValue, "symbol");
        if (typeof value !== "symbol") throw new TypeError("Expected Symbol receiver");
        return value.description;
      } }), "get"), configurable: true }
  });
  Object.defineProperty(prototype, Symbol.toPrimitive, { value: createSandboxClosure({ sandbox: true, name: "[Symbol.toPrimitive]", length: 1,
    call: (_args, context) => primitiveReceiver(context?.thisValue, "symbol") }), configurable: true });
  Object.defineProperty(prototype, Symbol.toStringTag, { value: "Symbol", configurable: true });
  const constructor = createSandboxClosure({
    sandbox: true,
    name: "Symbol",
    length: 0,
    retainedValues: () => [...entries.keys(), ...entries.values()],
    call: async ([description], context) => Symbol(description === undefined
      ? undefined
      : await sandboxString(description, budget, context)),
    properties: {
      prototype,
      for: createSandboxClosure({
        sandbox: true,
        name: "for",
        length: 1,
        call: async ([key], context) => {
          const text = await sandboxString(key, budget, context);
          let value = entries.get(text);
          if (value === undefined) {
            value = Symbol(text);
            entries.set(text, value);
          }
          return value;
        }
      }),
      keyFor: createSandboxClosure({
        sandbox: true,
        name: "keyFor",
        length: 1,
        call: ([value]) => {
          if (typeof value !== "symbol") throw new TypeError("Symbol.keyFor requires a symbol.");
          for (const [key, registered] of entries) if (registered === value) return key;
          return undefined;
        }
      }),
      ...wellKnownSymbols
    }
  });
  Object.defineProperty(prototype, "constructor", { value: constructor, writable: true, configurable: true });
  installBoxedPrototype(budget, prototype, constructor, "symbol");
  return constructor;
}
