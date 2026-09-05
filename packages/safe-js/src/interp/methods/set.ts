import type { Budget } from "../budget.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  isSandboxClosure,
  isSandboxSet,
  type SandboxClosure,
  type SandboxSet,
  type SandboxValue
} from "../values.js";
import { assertCollectionMutable } from "../running-state.js";
import {
  enterKeyedCollectionCallback,
  updateKeyedCollectionCallbacks
} from "./collection-callback.js";

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
    stack: readonly string[],
    thisValue?: SandboxValue
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
    call: (args, context) => {
      const receiver = context?.thisValue;
      if (!isSandboxSet(receiver)) throw new TypeError(`Set#${property} requires a Set receiver.`);
      return callSetMethod(receiver, property, args, options, context?.stack ?? []);
    },
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
      const exists = target.values.has(args[0]);
      const nextSize = exists ? target.values.size : target.values.size + 1;
      options.budget.allocateCollectionEntries(nextSize);
      if (!exists) updateKeyedCollectionCallbacks(target, "add", args[0]);
      target.values.add(args[0]);
      return target;
    }
    case "has":
      return target.values.has(args[0]);
    case "delete": {
      assertCollectionMutable(target);
      const deleted = target.values.delete(args[0]);
      if (deleted) updateKeyedCollectionCallbacks(target, "delete", args[0]);
      return deleted;
    }
    case "clear":
      assertCollectionMutable(target);
      target.values.clear();
      updateKeyedCollectionCallbacks(target, "clear");
      return undefined;
    case "forEach": {
      const callback = args[0];
      if (!isSandboxClosure(callback)) {
        throw new TypeError("Set.prototype.forEach requires a callback function.");
      }
      const cursor = enterKeyedCollectionCallback(target, target.values, options.budget);
      try {
        for (let entry = cursor.next(); !entry.done; entry = cursor.next()) {
          const value = entry.value;
          await options.callClosure(callback, [value, value, target], stack, args[1]);
        }
      } finally {
        cursor.leave();
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
