import { isFatalSandboxError, type Budget } from "../budget.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { acquireSandboxIterator, closeIterator, getSandboxIterator, readIteratorResult } from "../iteration.js";
import { getSandboxPrototype, setSandboxPrototype } from "../object-model.js";
import { toPropertyKey } from "../property-key.js";
import { retainValues } from "../resources.js";
import { allocateProducedSandboxValue, createSandboxClosure, createSandboxMap, defineOwnDataProperty, isSandboxClosure, measureSandboxData, type SandboxValue } from "../values.js";

export function createGroupBy(budget: Budget, keyMode: "property" | "identity") {
  return createSandboxClosure({
    guest: true, sandbox: true, name: "groupBy", length: 2,
    call: async ([items, callback], context) => {
      if (items === null || items === undefined) throw new TypeError("groupBy requires an iterable.");
      if (!isSandboxClosure(callback)) throw new TypeError("groupBy requires a callable callback.");
      const iterator = context === undefined ? getSandboxIterator(items, budget) : await acquireSandboxIterator(items, budget, context);
      if (iterator === undefined) throw new TypeError("groupBy requires an iterable.");
      const groups = createSandboxMap([]);
      let value: SandboxValue;
      let key: SandboxValue;
      const release = retainValues(budget, () => [groups, callback, iterator.retainedValue, value, key]);
      const checkpoint = createDataCheckpoint(budget, context);
      const closeOnThrow = async (error: unknown): Promise<never> => {
        try { await closeIterator(iterator, true); }
        catch (closeError) {
          if (!isFatalSandboxError(error) && isFatalSandboxError(closeError)) throw closeError;
        }
        throw error;
      };
      try {
        let index = 0;
        while (true) {
          try {
            budget.visitNode();
            if (index >= Number.MAX_SAFE_INTEGER) throw new TypeError("groupBy input exceeds the maximum index.");
          } catch (error) { await closeOnThrow(error); }
          const next = await iterator.next();
          if ((await readIteratorResult(iterator, next, "done")).value) break;
          value = (await readIteratorResult(iterator, next, "value")).value;
          try {
            key = await invokeBuiltinClosure(callback, [value, index], budget, context, undefined);
            if (keyMode === "property") key = await toPropertyKey(key, budget, context);
            let group = groups.entries.get(key) as SandboxValue[] | undefined;
            const added = group === undefined;
            if (group === undefined) {
              budget.allocateCollectionEntries(groups.entries.size + 1);
              group = [];
              const prototype = getSandboxPrototype(group, budget);
              if (prototype !== null) setSandboxPrototype(group, prototype, budget);
              groups.entries.set(key, group);
            }
            budget.allocateArrayLength(group.length + 1);
            group.push(value);
            const growth = 1 + (added ? 2 : 0) +
              (budget.limits.dataSize === undefined ? 0 : measureSandboxData(added ? [key, value] : [value]));
            checkpoint(groups, growth);
            value = key = undefined;
            index++;
          } catch (error) { await closeOnThrow(error); }
        }
        checkpoint(groups, 0, true);
        if (keyMode === "identity") return allocateProducedSandboxValue(groups, budget);
        const result = Object.create(null) as Record<string | symbol, SandboxValue>;
        setSandboxPrototype(result, null, budget);
        for (const [property, elements] of groups.entries) {
          budget.visitNode();
          defineOwnDataProperty(result, property as string | symbol, elements);
        }
        return allocateProducedSandboxValue(result, budget);
      } finally { release(); }
    }
  });
}
