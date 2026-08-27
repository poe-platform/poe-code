import type { Budget } from "../budget.js";
import {
  allocateProducedSandboxValue,
  createSandboxClosure,
  isSandboxClosure,
  type SandboxClosure,
  type SandboxMap,
  type SandboxValue
} from "../values.js";
import { assertCollectionMutable, enterCollectionCallback } from "../running-state.js";

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
    stack: readonly string[]
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
    call: (args, context) => callMapMethod(target, property, args, options, context?.stack ?? []),
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
      const nextSize = target.entries.has(args[0]) ? target.entries.size : target.entries.size + 1;
      options.budget.allocateCollectionEntries(nextSize);
      target.entries.set(args[0], args[1]);
      return target;
    }
    case "has":
      return target.entries.has(args[0]);
    case "delete":
      assertCollectionMutable(target);
      return target.entries.delete(args[0]);
    case "clear":
      assertCollectionMutable(target);
      target.entries.clear();
      return undefined;
    case "forEach": {
      const callback = args[0];
      if (!isSandboxClosure(callback)) {
        throw new TypeError("Map.prototype.forEach requires a callback function.");
      }
      const leaveCallback = enterCollectionCallback(target);
      try {
        const entries = [...target.entries];
        for (let index = 0; index < entries.length; index += 1) {
          const [key, value] = entries[index]!;
          await options.callClosure(callback, [value, key, target], stack);
        }
      } finally {
        leaveCallback();
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
