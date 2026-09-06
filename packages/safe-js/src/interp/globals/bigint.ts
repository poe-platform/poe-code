import type { Budget } from "../budget.js";
import { primitiveReceiver } from "../boxed.js";
import { installBoxedPrototype, materializeFunctionProperties } from "../object-model.js";
import { objectToPrimitive, sandboxNumber } from "../string-coercion.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxValue } from "../values.js";

export function createBigIntGlobal(budget: Budget) {
  const convert = async (value: SandboxValue, context?: SandboxCallContext, allowNumber = false): Promise<bigint> => {
    const primitive = value !== null && typeof value === "object"
      ? await objectToPrimitive(value, budget, context, new Set(), "number") : value;
    if (typeof primitive === "bigint") return primitive;
    if (typeof primitive !== "string" && typeof primitive !== "boolean" && !(allowNumber && typeof primitive === "number"))
      throw new TypeError("Cannot convert value to BigInt.");
    const size = typeof primitive === "string" ? primitive.length : 256;
    budget.visitNode(size);
    const allocation = {};
    budget.setRetainedDataUsage(allocation, size);
    try { return BigInt(primitive); }
    finally { budget.setRetainedDataUsage(allocation, 0); }
  };
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "BigInt", length: 1,
    call: ([value], context) => convert(value, context, true)
  });
  const prototype = Object.create(null);
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    valueOf: {
      value: createSandboxClosure({ sandbox: true, name: "valueOf", length: 0,
        call: (_args, context) => primitiveReceiver(context?.thisValue, "bigint") }),
      writable: true, configurable: true
    },
    toString: {
      value: createSandboxClosure({ sandbox: true, name: "toString", length: 1,
        call: async ([radix], context) => {
          const value = primitiveReceiver(context?.thisValue, "bigint") as bigint;
          const base = radix === undefined ? 10 : await sandboxNumber(radix, budget, context);
          const allocation = {};
          const size = value.toString(16).length * 4;
          budget.visitNode(size);
          budget.setRetainedDataUsage(allocation, size);
          try { return budget.allocateString(value.toString(base)); }
          finally { budget.setRetainedDataUsage(allocation, 0); }
        } }),
      writable: true, configurable: true
    },
    [Symbol.toStringTag]: { value: "BigInt", configurable: true }
  });
  const properties = materializeFunctionProperties(constructor);
  Object.defineProperty(properties, "prototype", { value: prototype });
  for (const name of ["asIntN", "asUintN"] as const) {
    Object.defineProperty(properties, name, {
      writable: true, configurable: true,
      value: createSandboxClosure({ sandbox: true, name, length: 2,
        call: async ([bits, input], context) => {
          const number = await sandboxNumber(bits, budget, context);
          const width = Number.isNaN(number) ? 0 : Math.trunc(number);
          if (width < 0 || !Number.isSafeInteger(width)) throw new RangeError("Invalid BigInt width.");
          const value = await convert(input, context);
          const size = value.toString(16).length;
          budget.visitNode(size);
          if (width >= size * 4 + 1 && (name === "asIntN" || value >= 0n)) return value;
          const allocation = {};
          budget.setRetainedDataUsage(allocation, Math.ceil(width / 4) + 1);
          try { return BigInt[name](width, value); }
          finally { budget.setRetainedDataUsage(allocation, 0); }
        } })
    });
  }
  installBoxedPrototype(budget, prototype, constructor, "bigint");
  return constructor;
}
