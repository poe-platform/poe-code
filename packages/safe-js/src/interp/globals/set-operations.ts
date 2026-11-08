import type { Budget } from "../budget.js";
import { readPropertyDescriptor } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { closeIterator, getSandboxIteratorFromMethod, readIteratorResult, type SandboxIterator } from "../iteration.js";
import { getSandboxPropertyDescriptor } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber } from "../string-coercion.js";
import { enterKeyedCollectionCallback } from "../methods/collection-callback.js";
import { allocateProducedSandboxValue, createSandboxClosure, createSandboxSet, isSandboxClosure, isSandboxSet, measureSandboxData, type SandboxCallContext, type SandboxValue } from "../values.js";

export const setOperationNames = ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"] as const;

export function createSetOperation(name: typeof setOperationNames[number], budget: Budget) {
  return createSandboxClosure({
    guest: true, sandbox: true, name, length: 1,
    call: async ([other], context) => {
      const receiver = context?.thisValue;
      if (!isSandboxSet(receiver)) throw new TypeError(`Set.prototype.${name} requires a Set receiver.`);
      if (typeof other !== "object" || other === null) throw new TypeError("Expected a set-like object.");
      const read = async (object: SandboxValue, key: PropertyKey): Promise<SandboxValue> =>
        context?.getProperty !== undefined ? context.getProperty(object, key)
          : readPropertyDescriptor(getSandboxPropertyDescriptor(object, key, budget) ?? { value: undefined }, object, context);
      const iterationContext: SandboxCallContext = { ...context, thisValue: receiver, stack: context?.stack ?? [], getProperty: read };
      const result = createSandboxSet([]);
      let iterator: SandboxIterator | undefined;
      let current: SandboxValue;
      let has: SandboxValue;
      let keys: SandboxValue;
      const release = retainValues(budget, () => [receiver, other, result, current, has, keys, iterator?.retainedValue]);
      const checkpoint = createDataCheckpoint(budget, context);
      const add = (value: SandboxValue) => {
        budget.visitNode();
        if (result.values.has(value)) return;
        budget.allocateCollectionEntries(result.values.size + 1);
        result.values.add(value);
        checkpoint(result, 1 + (budget.limits.dataSize === undefined ? 0 : measureSandboxData([value])));
      };
      try {
        const numericSize = await sandboxNumber(await read(other, "size"), budget, context);
        if (Number.isNaN(numericSize)) throw new TypeError("Invalid set-like size.");
        const size = Math.trunc(numericSize);
        if (size < 0) throw new RangeError("Negative set-like size.");
        has = await read(other, "has");
        if (!isSandboxClosure(has)) throw new TypeError("Set-like has must be callable.");
        keys = await read(other, "keys");
        if (!isSandboxClosure(keys)) throw new TypeError("Set-like keys must be callable.");

        if (name === "isSubsetOf" && receiver.values.size > size ||
            name === "isSupersetOf" && receiver.values.size < size) return false;
        const visitReceiver = name === "isSubsetOf" ||
          (name === "intersection" || name === "difference" || name === "isDisjointFrom") && receiver.values.size <= size;
        if (name === "union" || name === "symmetricDifference")
          iterator = await getSandboxIteratorFromMethod(other, keys, budget, iterationContext);
        if (name === "union" || name === "symmetricDifference" || name === "difference")
          for (const value of receiver.values) add(value);

        if (visitReceiver) {
          // Difference reads its initial copy; the other operations observe
          // receiver additions/removals made by the set-like has callback.
          const target = name === "difference" ? result : receiver;
          const cursor = enterKeyedCollectionCallback(target, target.values, budget);
          try {
            for (let next = cursor.next(); !next.done; next = cursor.next()) {
              current = next.value;
              const found = Boolean(await invokeBuiltinClosure(has, [current], budget, context, other));
              if (name === "isSubsetOf" && !found || name === "isDisjointFrom" && found) return false;
              if (name === "intersection" && found) add(current);
              if (name === "difference" && found) result.values.delete(current);
              current = undefined;
            }
          } finally { cursor.leave(); }
        } else {
          iterator ??= await getSandboxIteratorFromMethod(other, keys, budget, iterationContext);
          while (true) {
            budget.visitNode();
            const next = await iterator.next();
            if ((await readIteratorResult(iterator, next, "done")).value) break;
            current = (await readIteratorResult(iterator, next, "value")).value;
            const found = receiver.values.has(current);
            if (name === "isSupersetOf" && !found || name === "isDisjointFrom" && found) {
              await closeIterator(iterator);
              return false;
            }
            if (name === "union" || name === "intersection" && found ||
                name === "symmetricDifference" && !found) add(current);
            else if (name === "difference" || name === "symmetricDifference" && found) result.values.delete(current);
            current = undefined;
          }
        }
        if (name === "isSubsetOf" || name === "isSupersetOf" || name === "isDisjointFrom") return true;
        checkpoint(result, 0, true);
        return allocateProducedSandboxValue(result, budget);
      } finally { release(); }
    }
  });
}
