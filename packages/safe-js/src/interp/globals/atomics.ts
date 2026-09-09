import type { Budget } from "../budget.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { createIntrinsicObject, registerIntrinsicFunction, registerIntrinsicObject } from "../object-model.js";
import { retainValues } from "../resources.js";
import { sandboxNumber } from "../string-coercion.js";
import { isNumericTypedArray, typedArrayStorage } from "../typed-array.js";
import { createSandboxClosure, type SandboxObject } from "../values.js";
import { sandboxBigInt } from "./bigint.js";

const atomicMethods = {
  add: Atomics.add, and: Atomics.and, compareExchange: Atomics.compareExchange,
  exchange: Atomics.exchange, isLockFree: Atomics.isLockFree, load: Atomics.load,
  or: Atomics.or, store: Atomics.store, sub: Atomics.sub,
  wait: Atomics.wait,
  waitAsync: Reflect.get(Atomics, "waitAsync") as (...args: unknown[]) => unknown,
  notify: Atomics.notify, xor: Atomics.xor
};
const integerArrayTypes = new Set<unknown>([
  Int8Array, Uint8Array, Int16Array, Uint16Array, Int32Array, Uint32Array,
  BigInt64Array, BigUint64Array
]);

export function createAtomicsGlobal(budget: Budget): SandboxObject {
  const atomics = createIntrinsicObject({});
  for (const [name, method] of Object.entries(atomicMethods)) {
    const closure = createSandboxClosure({
      sandbox: true, guest: true, name, length: method.length,
      call: async (args, context) => {
        const values: Array<number | bigint> = [];
        const release = retainValues(budget, () => [...args, ...values]);
        try {
          budget.visitNode();
          if (name === "isLockFree") return Reflect.apply(method, Atomics, [await sandboxNumber(args[0], budget, context)]) as boolean;
          const [view, requestedIndex] = args;
          if (!isNumericTypedArray(view)) throw new TypeError("Atomics requires an integer typed array.");
          const storage = typedArrayStorage(view, true);
          const waitable = name === "wait" || name === "waitAsync" || name === "notify";
          if (waitable ? storage.Native !== Int32Array && storage.Native !== BigInt64Array : !integerArrayTypes.has(storage.Native))
            throw new TypeError("Invalid typed array for Atomics operation.");
          // typedArrayStorage admits only non-shared buffers. DoWait rejects
          // these before index/value/timeout coercion; it must never block here.
          if (name === "wait" || name === "waitAsync") throw new TypeError("Atomics.wait requires shared storage.");
          const number = await sandboxNumber(requestedIndex, budget, context);
          const index = Number.isNaN(number) ? 0 : Math.trunc(number);
          if (index < 0 || !Number.isSafeInteger(index) || index >= storage.length)
            throw new RangeError("Invalid atomic access index.");
          if (name === "notify") {
            if (args[2] !== undefined) await sandboxNumber(args[2], budget, context);
            // Non-shared notify returns zero without revalidating after coercion.
            return 0;
          }
          for (let offset = 2; offset < method.length; offset++) {
            values.push(storage.Native === BigInt64Array || storage.Native === BigUint64Array
              ? await sandboxBigInt(args[offset], budget, context)
              : await sandboxNumber(args[offset], budget, context));
          }
          // Guest conversions above may detach, shrink, or regrow the storage.
          // Native invocation now receives primitives only and revalidates it.
          return Reflect.apply(method, Atomics, [view, index, ...values]) as number | bigint;
        } finally { release(); }
      }
    });
    Object.defineProperty(atomics, name, { value: closure, writable: true, configurable: true });
    registerIntrinsicFunction(budget, closure);
  }
  Object.defineProperty(atomics, Symbol.toStringTag, { value: "Atomics", configurable: true });
  registerBuiltinIdentities(budget, { Atomics: atomics });
  registerIntrinsicObject(budget, atomics);
  return atomics;
}
