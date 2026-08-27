import type { Budget } from "../budget.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  isSandboxClosure,
  type SandboxClosure,
  type SandboxSet,
  type SandboxValue
} from "../values.js";
import { assertCollectionMutable, enterCollectionCallback } from "../running-state.js";

export type SetMethodName =
  | "add"
  | "has"
  | "delete"
  | "clear"
  | "forEach"
  | "keys"
  | "values"
  | "entries";

export type SetMethodOptions = {
  budget: Budget;
  callClosure: (
    closure: SandboxClosure,
    args: readonly SandboxValue[],
    stack: readonly string[]
  ) => Promise<SandboxValue>;
};

const setMethodNames = new Set<SetMethodName>([
  "add",
  "has",
  "delete",
  "clear",
  "forEach",
  "keys",
  "values",
  "entries"
]);

export function isSetMethodName(value: string | number): value is SetMethodName {
  return typeof value === "string" && setMethodNames.has(value as SetMethodName);
}

export function getSetMember(
  target: SandboxSet,
  property: string | number,
  options: SetMethodOptions
): SandboxValue | undefined {
  if (property === "size") {
    return target.values.size;
  }

  if (!isSetMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    sandbox: true,
    call: (args, context) => callSetMethod(target, property, args, options, context?.stack ?? []),
    name: property
  });
}

export async function callSetMethod(
  target: SandboxSet,
  methodName: SetMethodName,
  args: readonly SandboxValue[],
  options: SetMethodOptions,
  stack: readonly string[] = []
): Promise<SandboxValue> {
  switch (methodName) {
    case "add": {
      assertCollectionMutable(target);
      const nextSize = target.values.has(args[0]) ? target.values.size : target.values.size + 1;
      options.budget.allocateCollectionEntries(nextSize);
      target.values.add(args[0]);
      return target;
    }
    case "has":
      return target.values.has(args[0]);
    case "delete":
      assertCollectionMutable(target);
      return target.values.delete(args[0]);
    case "clear":
      assertCollectionMutable(target);
      target.values.clear();
      return undefined;
    case "forEach": {
      const callback = args[0];
      if (!isSandboxClosure(callback)) {
        throw new TypeError("Set.prototype.forEach requires a callback function.");
      }
      const leaveCallback = enterCollectionCallback(target);
      try {
        const values = [...target.values];
        for (let index = 0; index < values.length; index += 1) {
          const value = values[index];
          await options.callClosure(callback, [value, value, target], stack);
        }
      } finally {
        leaveCallback();
      }
      return undefined;
    }
    case "keys":
    case "values":
      return allocateProducedSandboxValue([...target.values], options.budget);
    case "entries":
      return allocateProducedSandboxValue(
        [...target.values].map((value) => [value, value]),
        options.budget
      );
  }
}
