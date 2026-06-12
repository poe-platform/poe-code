import type { Budget } from "../budget.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  deepCopyToSandbox,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxValue
} from "../values.js";

export type MiscGlobals = {
  structuredClone: SandboxClosure;
  parseInt: SandboxClosure;
  parseFloat: SandboxClosure;
  isNaN: SandboxClosure;
  isFinite: SandboxClosure;
};

export function createMiscGlobals(options: { budget: Budget }): MiscGlobals {
  return {
    structuredClone: createSandboxClosure({
      call: ([value]) => structuredCloneSandboxValue(value, options.budget),
      name: "structuredClone"
    }),
    parseInt: createSandboxClosure({
      call: (args) => Reflect.apply(globalThis.parseInt, globalThis, [...args]),
      name: "parseInt"
    }),
    parseFloat: createSandboxClosure({
      call: (args) => Reflect.apply(globalThis.parseFloat, globalThis, [...args]),
      name: "parseFloat"
    }),
    isNaN: createSandboxClosure({
      call: ([value]) => globalThis.isNaN(value as number),
      name: "isNaN"
    }),
    isFinite: createSandboxClosure({
      call: ([value]) => globalThis.isFinite(value as number),
      name: "isFinite"
    })
  };
}

function structuredCloneSandboxValue(value: SandboxValue, budget: Budget): SandboxValue {
  const clone = deepCopyToSandbox(value);
  assertStructuredCloneable(clone, new WeakSet());
  return allocateProducedSandboxValue(clone, budget);
}

function assertStructuredCloneable(value: SandboxValue, seen: WeakSet<object>): void {
  if (isSandboxClosure(value) || isSandboxPromise(value)) {
    throw new TypeError("structuredClone() cannot clone closures or promises.");
  }

  if (typeof value !== "object" || value === null || seen.has(value)) {
    return;
  }

  seen.add(value);
  for (const entry of Object.values(value)) {
    assertStructuredCloneable(entry, seen);
  }
}
