import type { Budget } from "../budget.js";
import { assertSandboxGraphDepth } from "../../graph-depth.js";
import {
  allocateProducedSandboxValue,
  cloneSandboxValue,
  createSandboxClosure,
  isSandboxClosure,
  isSandboxMap,
  isSandboxPromise,
  isSandboxSet,
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
      sandbox: true,
      call: ([value]) => structuredCloneSandboxValue(value, options.budget),
      name: "structuredClone"
    }),
    parseInt: createSandboxClosure({
      sandbox: true,
      call: (args) => Reflect.apply(globalThis.parseInt, globalThis, [...args]),
      name: "parseInt"
    }),
    parseFloat: createSandboxClosure({
      sandbox: true,
      call: (args) => Reflect.apply(globalThis.parseFloat, globalThis, [...args]),
      name: "parseFloat"
    }),
    isNaN: createSandboxClosure({
      sandbox: true,
      call: ([value]) => globalThis.isNaN(value as number),
      name: "isNaN"
    }),
    isFinite: createSandboxClosure({
      sandbox: true,
      call: ([value]) => globalThis.isFinite(value as number),
      name: "isFinite"
    })
  };
}

function structuredCloneSandboxValue(value: SandboxValue, budget: Budget): SandboxValue {
  assertSandboxGraphDepth(value);
  const clone = cloneSandboxValue(value);
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
  if (isSandboxMap(value)) {
    for (const [key, entry] of value.entries) {
      assertStructuredCloneable(key, seen);
      assertStructuredCloneable(entry, seen);
    }
    return;
  }
  if (isSandboxSet(value)) {
    for (const entry of value.values) {
      assertStructuredCloneable(entry, seen);
    }
    return;
  }
  for (const entry of Object.values(value)) {
    assertStructuredCloneable(entry, seen);
  }
}
