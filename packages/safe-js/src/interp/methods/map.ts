import type { Budget } from "../budget.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  isSandboxClosure,
  isSandboxMap,
  type SandboxClosure,
  type SandboxMap,
  type SandboxValue
} from "../values.js";
import { assertCollectionMutable } from "../running-state.js";
import {
  enterKeyedCollectionCallback,
  updateKeyedCollectionCallbacks
} from "./collection-callback.js";

export type MapMethodName =
  | "get"
  | "set"
  | "has"
  | "delete"
  | "clear"
  | "forEach"
  | "keys"
  | "values"
  | "entries";

export type MapMethodOptions = {
  budget: Budget;
  callClosure: (
    closure: SandboxClosure,
    args: readonly SandboxValue[],
    stack: readonly string[],
    thisValue?: SandboxValue
  ) => Promise<SandboxValue>;
};

const mapMethodNames = new Set<MapMethodName>([
  "get",
  "set",
  "has",
  "delete",
  "clear",
  "forEach",
  "keys",
  "values",
  "entries"
]);

export function isMapMethodName(value: string | number): value is MapMethodName {
  return typeof value === "string" && mapMethodNames.has(value as MapMethodName);
}

export function getMapMember(
  target: SandboxMap,
  property: string | number,
  options: MapMethodOptions
): SandboxValue | undefined {
  if (property === "size") {
    return target.entries.size;
  }

  if (!isMapMethodName(property)) {
    return undefined;
  }

  return createSandboxClosure({
    sandbox: true,
    call: (args, context) => {
      const receiver = context?.thisValue;
      if (!isSandboxMap(receiver)) throw new TypeError(`Map#${property} requires a Map receiver.`);
      return callMapMethod(receiver, property, args, options, context?.stack ?? []);
    },
    name: property
  });
}

export async function callMapMethod(
  target: SandboxMap,
  methodName: MapMethodName,
  args: readonly SandboxValue[],
  options: MapMethodOptions,
  stack: readonly string[] = []
): Promise<SandboxValue> {
  switch (methodName) {
    case "get":
      return target.entries.get(args[0]);
    case "set": {
      assertCollectionMutable(target);
      const exists = target.entries.has(args[0]);
      const nextSize = exists ? target.entries.size : target.entries.size + 1;
      options.budget.allocateCollectionEntries(nextSize);
      if (!exists) updateKeyedCollectionCallbacks(target, "add", args[0]);
      target.entries.set(args[0], args[1]);
      return target;
    }
    case "has":
      return target.entries.has(args[0]);
    case "delete": {
      assertCollectionMutable(target);
      const deleted = target.entries.delete(args[0]);
      if (deleted) updateKeyedCollectionCallbacks(target, "delete", args[0]);
      return deleted;
    }
    case "clear":
      assertCollectionMutable(target);
      target.entries.clear();
      updateKeyedCollectionCallbacks(target, "clear");
      return undefined;
    case "forEach": {
      const callback = args[0];
      if (!isSandboxClosure(callback)) {
        throw new TypeError("Map.prototype.forEach requires a callback function.");
      }
      const cursor = enterKeyedCollectionCallback(target, target.entries.keys(), options.budget);
      try {
        for (let entry = cursor.next(); !entry.done; entry = cursor.next()) {
          const key = entry.value;
          const value = target.entries.get(key);
          await options.callClosure(callback, [value, key, target], stack, args[1]);
        }
      } finally {
        cursor.leave();
      }
      return undefined;
    }
    case "keys":
      return allocateProducedSandboxValue([...target.entries.keys()], options.budget);
    case "values":
      return allocateProducedSandboxValue([...target.entries.values()], options.budget);
    case "entries":
      return allocateProducedSandboxValue(
        [...target.entries].map(([key, value]) => [key, value]),
        options.budget
      );
  }
}
