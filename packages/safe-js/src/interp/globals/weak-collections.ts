import { isFatalSandboxError, type Budget } from "../budget.js";
import { readPropertyDescriptor } from "../accessors.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { acquireSandboxIterator, closeIterator, getSandboxIterator, readIteratorResult } from "../iteration.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { retainValues } from "../resources.js";
import { canHoldWeakTarget } from "../weak-reference.js";
import { createWeakCollection, deleteWeakEntry, setWeakEntry, weakCollectionStates } from "../weak-collection.js";
import { allocateProducedSandboxValue, createSandboxClosure, isSandboxClosure, measureSandboxData, type SandboxClosure, type SandboxValue } from "../values.js";

export function createWeakCollectionGlobals(budget: Budget): { WeakMap: SandboxClosure; WeakSet: SandboxClosure } {
  const constructors = {} as { WeakMap: SandboxClosure; WeakSet: SandboxClosure };
  for (const [name, kind, adderName] of [["WeakMap", "map", "set"], ["WeakSet", "set", "add"]] as const) {
    const prototype = createIntrinsicObject();
    const constructor = createSandboxClosure({
      guest: true, sandbox: true, name, length: 0,
      call: () => { throw new TypeError(`Constructor ${name} requires 'new'.`); },
      construct: async ([source], context) => {
        const collection = createWeakCollection(kind);
        const read = async (value: SandboxValue, key: string): Promise<SandboxValue> => {
          budget.visitNode();
          if (context?.getProperty !== undefined) return context.getProperty(value, key);
          const descriptor = getSandboxPropertyDescriptor(value, key, budget);
          return descriptor === undefined ? undefined : readPropertyDescriptor(descriptor, value, context);
        };
        let entry: SandboxValue, key: SandboxValue, value: SandboxValue, adder: SandboxValue;
        const release = retainValues(budget, () => [source, collection, entry, key, value, adder]);
        try {
          const selected = context?.newTarget === undefined ? prototype : await read(context.newTarget, "prototype");
          setSandboxPrototype(collection, typeof selected === "object" && selected !== null ? selected
            : getFunctionRealmPrototype(context?.newTarget ?? constructor, name, prototype), budget);
          allocateProducedSandboxValue(collection, budget);
          if (source === undefined || source === null) return collection;
          adder = await read(collection, adderName);
          if (!isSandboxClosure(adder)) throw new TypeError(`${name} constructor adder must be callable.`);
          const iterator = context === undefined ? getSandboxIterator(source, budget) : await acquireSandboxIterator(source, budget, context);
          if (iterator === undefined) throw new TypeError(`${name} constructor requires an iterable.`);
          const releaseIterator = retainValues(budget, () => [iterator.retainedValue]);
          try {
            while (true) {
              const next = await iterator.next();
              if ((await readIteratorResult(iterator, next, "done")).value) break;
              entry = (await readIteratorResult(iterator, next, "value")).value;
              try {
                budget.visitNode();
                if (kind === "map") {
                  if (entry === null || typeof entry !== "object") throw new TypeError("WeakMap constructor requires entry objects.");
                  key = await read(entry, "0");
                  value = await read(entry, "1");
                  await invokeBuiltinClosure(adder, [key, value], budget, context, collection);
                } else await invokeBuiltinClosure(adder, [entry], budget, context, collection);
                entry = key = value = undefined;
              } catch (error) {
                try { await closeIterator(iterator, true); }
                catch (closeError) { if (!isFatalSandboxError(error) && isFatalSandboxError(closeError)) throw closeError; }
                throw error;
              }
            }
          } finally { releaseIterator(); }
          return collection;
        } finally { release(); }
      }
    });
    Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
    Object.defineProperties(prototype, {
      constructor: { value: constructor, writable: true, configurable: true },
      [Symbol.toStringTag]: { value: name, configurable: true }
    });
    for (const method of [adderName, "delete", "has", ...(kind === "map" ? ["get", "getOrInsert", "getOrInsertComputed"] : [])]) {
      Object.defineProperty(prototype, method, { writable: true, configurable: true, value: createSandboxClosure({
        guest: true, sandbox: true, name: method,
        length: method === "set" || method === "getOrInsert" || method === "getOrInsertComputed" ? 2 : 1,
        call: ([key, value], context) => {
          const receiver = context?.thisValue;
          const state = receiver !== null && typeof receiver === "object" ? weakCollectionStates.get(receiver) : undefined;
          if (state?.kind !== kind) throw new TypeError(`Incompatible ${name} receiver.`);
          const weakKey = canHoldWeakTarget(key, budget) ? key : undefined;
          const insert = method === "getOrInsert" || method === "getOrInsertComputed";
          if (method === adderName || insert) {
            if (weakKey === undefined) throw new TypeError("Invalid weak collection key.");
            if (method === "getOrInsertComputed" && !isSandboxClosure(value))
              throw new TypeError("WeakMap.prototype.getOrInsertComputed requires a callback function.");
            if (insert && state.entries.has(weakKey)) return state.entries.get(weakKey)!.value;
            const store = (stored: SandboxValue) => {
              const added = state.entries.has(weakKey) ? 0 : 1;
              if (budget.limits.arrayLength !== undefined && state.references.size + added > budget.limits.arrayLength) {
                for (const reference of state.references) {
                  budget.visitNode();
                  if (reference.deref() === undefined) {
                    state.references.delete(reference);
                    state.cleanup.unregister(reference);
                  }
                }
              }
              budget.allocateCollectionEntries(state.references.size + added);
              setWeakEntry(receiver as object, weakKey, kind === "map" ? stored : undefined);
              createDataCheckpoint(budget, context)(receiver, 1 + (budget.limits.dataSize === undefined ? 0 : measureSandboxData([key, stored])));
              return insert ? stored : receiver;
            };
            if (method === "getOrInsertComputed") {
              let computed: SandboxValue;
              const release = retainValues(budget, () => [receiver, key, value, computed]);
              return invokeBuiltinClosure(value as SandboxClosure, [key], budget, context, undefined)
                .then(result => { computed = result; return store(result); })
                .finally(release);
            }
            return store(value);
          }
          if (method === "get") return weakKey === undefined ? undefined : state.entries.get(weakKey)?.value;
          if (method === "has") return weakKey !== undefined && state.entries.has(weakKey);
          return weakKey !== undefined && deleteWeakEntry(receiver as object, weakKey);
        }
      }) });
    }
    setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
    registerIntrinsicFunction(budget, constructor);
    registerIntrinsicObject(budget, prototype);
    constructors[name] = constructor;
  }
  return constructors;
}
