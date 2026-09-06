import type { Budget } from "../budget.js";
import { isSandboxCollectionIterator } from "../collection-iterator.js";
import { isSandboxRegExpIterator } from "../regexp-iterator.js";
import { assertSandboxGraphDepth } from "../../graph-depth.js";
import { CompileScope } from "../regex/compile-guard.js";
import { createNumericParsers } from "./numeric-parsers.js";
import { sandboxNumber } from "../string-coercion.js";
import {
  allocateProducedSandboxValue,
  cloneSandboxValue,
  createSandboxClosure,
  isSandboxClosure,
  isSandboxMap,
  isSandboxPromise,
  isSandboxSet,
  reconcileCompiledValues,
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
      call: ([value], context) => structuredCloneSandboxValue(value, options.budget, context?.compilation),
      name: "structuredClone"
    }),
    ...createNumericParsers(options.budget),
    isNaN: createSandboxClosure({
      sandbox: true,
      call: ([value], context) => {
        const number = sandboxNumber(value, options.budget, context);
        return typeof number === "number" ? Number.isNaN(number) : number.then(Number.isNaN);
      },
      name: "isNaN"
    }),
    isFinite: createSandboxClosure({
      sandbox: true,
      call: ([value], context) => {
        const number = sandboxNumber(value, options.budget, context);
        return typeof number === "number" ? Number.isFinite(number) : number.then(Number.isFinite);
      },
      name: "isFinite"
    })
  };
}

function structuredCloneSandboxValue(value: SandboxValue, budget: Budget, parent?: CompileScope): SandboxValue {
  const operation = budget.acquireCompileOwner(false, parent?.owner);
  const compilation = parent?.owner === operation.owner ? parent : new CompileScope(operation.owner);
  try {
    const clone = cloneSandboxValue(value, { compilation, resetRegexLastIndex: true, structuredClone: true });
    assertSandboxGraphDepth(clone);
    assertStructuredCloneable(clone, new WeakSet());
    allocateProducedSandboxValue(clone, budget);
    if (compilation !== parent) reconcileCompiledValues(budget, [clone], compilation);
    return clone;
  } finally {
    if (compilation !== parent) compilation.dispose();
    operation.release();
  }
}

function assertStructuredCloneable(value: SandboxValue, seen: WeakSet<object>): void {
  if (isSandboxClosure(value) || isSandboxPromise(value) || isSandboxCollectionIterator(value) || isSandboxRegExpIterator(value)) {
    throw new TypeError("structuredClone() cannot clone closures, promises, or collection iterators.");
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
