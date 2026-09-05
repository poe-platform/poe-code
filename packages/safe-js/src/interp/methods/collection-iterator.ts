import type { Budget } from "../budget.js";
import { collectionIteratorState, isSandboxCollectionIterator, nextCollectionIterator, type SandboxCollectionIterator } from "../collection-iterator.js";
import { createSandboxClosure, type SandboxValue } from "../values.js";

export function getCollectionIteratorMember(
  target: SandboxCollectionIterator,
  property: string | number,
  budget: Budget
): SandboxValue {
  if (Object.hasOwn(target, property)) return (target as unknown as Record<string, SandboxValue>)[property];
  if (property !== "next") return undefined;
  const { collectionKind } = collectionIteratorState(target);
  return createSandboxClosure({
    sandbox: true,
    name: "next",
    call: (_args, context) => {
      const receiver = context?.thisValue;
      if (!isSandboxCollectionIterator(receiver) || collectionIteratorState(receiver).collectionKind !== collectionKind)
        throw new TypeError("Iterator next requires a matching collection iterator receiver.");
      return nextCollectionIterator(receiver, budget);
    }
  });
}
