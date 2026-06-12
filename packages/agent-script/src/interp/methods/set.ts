import type { Budget } from "../budget.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  isSandboxClosure,
  isSandboxPromise,
  type SandboxClosure,
  type SandboxSet,
  type SandboxValue
} from "../values.js";

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
      const nextSize = target.values.has(args[0]) ? target.values.size : target.values.size + 1;
      options.budget.allocateCollectionEntries(nextSize);
      target.values.add(args[0]);
      return target;
    }
    case "has":
      return target.values.has(args[0]);
    case "delete":
      return target.values.delete(args[0]);
    case "clear":
      target.values.clear();
      return undefined;
    case "forEach": {
      const callback = args[0];
      if (!isSandboxClosure(callback)) {
        throw new TypeError("Set.prototype.forEach requires a callback function.");
      }
      for (const value of target.values) {
        const result = await options.callClosure(callback, [value, value, target], stack);
        if (isSandboxPromise(result)) {
          await result.promise;
        }
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
