import type { Budget } from "../budget.js";
import { arrayBufferDetached, arrayBufferLength, arrayBufferOptions, arrayBufferPrototypes, isSandboxArrayBuffer } from "../array-buffer.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { createSandboxClosure, isSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";
import { createIntrinsicObject, getSandboxDataProperty, getSandboxPropertyDescriptor, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { sandboxNumber } from "../string-coercion.js";
import { retainValues } from "../resources.js";
import { createDataCheckpoint } from "../data-checkpoint.js";

const resizeBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")?.value as ((length: number) => void) | undefined;
const transferBuffer = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "transfer")?.value as ((length?: number) => ArrayBuffer) | undefined;

export function createArrayBufferGlobal(budget: Budget): SandboxClosure {
  const prototype: SandboxObject = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "ArrayBuffer", length: 1,
    call: () => { throw new TypeError("ArrayBuffer requires new."); },
    construct: async (args, context) => {
      let selected: unknown;
      let current: SandboxValue;
      const callerContext: SandboxCallContext = {
        ...context, stack: context?.stack ?? [], thisValue: undefined,
        getProperty: context?.getProperty ?? ((value, key) => sandboxGetProperty(value, key, value, budget, bridge))
      };
      const bridge: SandboxCallContext = {
        ...callerContext,
        invokeClosure: context?.invokeClosure ?? ((callee, values, receiver, construct, newTarget) =>
          invokeBuiltinClosure(callee, values, budget, callerContext, receiver, construct, newTarget))
      };
      const release = retainValues(budget, () => [selected, current, ...args]);
      try {
        const number = await sandboxNumber(args[0], budget, bridge);
        const length = Number.isNaN(number) ? 0 : Math.trunc(number);
        if (length < 0 || !Number.isSafeInteger(length)) throw new RangeError("Invalid ArrayBuffer length.");
        let maxByteLength: number | undefined;
        if (args[1] !== null && typeof args[1] === "object") {
          current = await bridge.getProperty!(args[1], "maxByteLength");
          if (current !== undefined) {
            const maximum = await sandboxNumber(current, budget, bridge);
            maxByteLength = Number.isNaN(maximum) ? 0 : Math.trunc(maximum);
            if (!Number.isSafeInteger(maxByteLength) || maxByteLength < length)
              throw new RangeError("Invalid ArrayBuffer maximum length.");
          }
        }
        const target = context?.newTarget ?? constructor;
        selected = await bridge.getProperty!(target, "prototype");
        if (maxByteLength !== undefined && resizeBuffer === undefined)
          throw new TypeError("Resizable ArrayBuffer requires host runtime support.");
        budget.allocateArrayLength(maxByteLength ?? length);
        budget.provisionDataUsage(length + 1)();
        const result = Reflect.construct(ArrayBuffer, [length, maxByteLength === undefined ? undefined : { maxByteLength }]) as ArrayBuffer;
        setSandboxPrototype(result, selected !== null && typeof selected === "object" ? selected : prototype, budget);
        return result;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype, writable: false });
  Object.defineProperty(materializeFunctionProperties(constructor), "isView", {
    writable: true, configurable: true,
    value: createSandboxClosure({ guest: true, sandbox: true, name: "isView", length: 1,
      call: args => ArrayBuffer.isView(args[0]) || isNumericTypedArray(args[0]) })
  });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "ArrayBuffer", configurable: true }
  });
  const getters: SandboxClosure[] = [];
  const species = createSandboxClosure({ guest: true, sandbox: true, name: "get [Symbol.species]", length: 0,
    call: (_args, context) => context?.thisValue });
  getters.push(species);
  Object.defineProperty(materializeFunctionProperties(constructor), Symbol.species, {
    get: accessorAdapter(species, "get"), configurable: true
  });
  Object.defineProperty(prototype, "slice", { writable: true, configurable: true,
    value: createSandboxClosure({ guest: true, sandbox: true, name: "slice", length: 2,
      call: async (args, context) => {
        const receiver = context?.thisValue;
        if (!isSandboxArrayBuffer(receiver)) throw new TypeError("ArrayBuffer slice requires a buffer receiver.");
        // A zero-length view validates detachment even on hosts without .detached.
        new Uint8Array(receiver, 0, 0);
        const length = arrayBufferLength(receiver);
        let candidate: SandboxValue;
        let result: SandboxValue;
        const bridge: SandboxCallContext = {
          ...context, stack: context?.stack ?? [], thisValue: receiver,
          getProperty: context?.getProperty ?? ((value, key) => {
            const descriptor = getSandboxPropertyDescriptor(value, key, budget);
            return descriptor === undefined ? getSandboxDataProperty(value, key, budget)
              : readPropertyDescriptor(descriptor, value, bridge);
          }),
          invokeClosure: context?.invokeClosure ?? ((callee, values, thisValue, construct) =>
            invokeBuiltinClosure(callee, values, budget, context, thisValue, construct))
        };
        const release = retainValues(budget, () => [receiver, candidate, result, ...args]);
        const clamp = (number: number) => {
          const integer = Number.isNaN(number) ? 0 : Math.trunc(number);
          return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length);
        };
        try {
          const start = clamp(await sandboxNumber(args[0], budget, bridge));
          const end = args[1] === undefined ? length : clamp(await sandboxNumber(args[1], budget, bridge));
          const size = Math.max(end - start, 0);
          candidate = await bridge.getProperty!(receiver, "constructor");
          if (candidate !== undefined) {
            if (candidate === null || typeof candidate !== "object")
              throw new TypeError("ArrayBuffer constructor must be an object.");
            candidate = await bridge.getProperty!(candidate, Symbol.species);
            if (candidate !== undefined && candidate !== null &&
                (!isSandboxClosure(candidate) || candidate.construct === undefined))
              throw new TypeError("ArrayBuffer species must be a constructor.");
          }
          if (candidate === undefined || candidate === null || candidate === constructor) {
            budget.allocateArrayLength(size);
            budget.provisionDataUsage(size + 1)();
            result = new ArrayBuffer(size);
            setSandboxPrototype(result, prototype, budget);
          } else result = await invokeBuiltinClosure(candidate as SandboxClosure, [size], budget, bridge, undefined, true);
          if (!isSandboxArrayBuffer(result) || result === receiver || arrayBufferLength(result) < size)
            throw new TypeError("ArrayBuffer species must return distinct sufficient buffer storage.");
          new Uint8Array(result, 0, 0);
          new Uint8Array(receiver, 0, 0);
          const count = Math.min(size, Math.max(arrayBufferLength(receiver) - start, 0));
          if (count > 0) new Uint8Array(result, 0, count).set(new Uint8Array(receiver, start, count));
          return result;
        } finally { release(); }
      }
    })
  });
  for (const key of ["transfer", "transferToFixedLength"]) Object.defineProperty(prototype, key, { writable: true, configurable: true,
    value: createSandboxClosure({ guest: true, sandbox: true, name: key, length: 0,
      call: async (args, context) => {
        const receiver = context?.thisValue;
        if (!isSandboxArrayBuffer(receiver)) throw new TypeError("ArrayBuffer transfer requires a buffer receiver.");
        let result: ArrayBuffer | undefined;
        const release = retainValues(budget, () => [receiver, result, ...args]);
        const checkData = createDataCheckpoint(budget, context);
        try {
          const number = args[0] === undefined ? arrayBufferLength(receiver) : await sandboxNumber(args[0], budget, context);
          const length = Number.isNaN(number) ? 0 : Math.trunc(number);
          if (!Number.isSafeInteger(length) || length < 0) throw new RangeError("Invalid ArrayBuffer transfer length.");
          if (arrayBufferDetached(receiver)) throw new TypeError("Cannot transfer a detached ArrayBuffer.");
          const options = key === "transfer" ? arrayBufferOptions(receiver) : undefined;
          if (options !== undefined && length > options.maxByteLength) throw new RangeError("Transfer length exceeds ArrayBuffer capacity.");
          budget.allocateArrayLength(options?.maxByteLength ?? length);
          checkData(receiver, 0, true);
          budget.provisionDataUsage(length + 1)();
          result = Reflect.construct(ArrayBuffer, [length, options]) as ArrayBuffer;
          setSandboxPrototype(result, prototype, budget);
          checkData(result, 0, true);
          const count = Math.min(length, arrayBufferLength(receiver));
          budget.visitNode(count);
          new Uint8Array(result, 0, count).set(new Uint8Array(receiver, 0, count));
          if (transferBuffer !== undefined) {
            budget.provisionDataUsage(1)();
            Reflect.apply(transferBuffer, receiver, [0]);
          } else {
            // Some old hosts copy non-detachable buffers instead of throwing.
            // Bound that temporary copy and verify that transfer really occurred.
            budget.provisionDataUsage(arrayBufferLength(receiver) + 1)();
            budget.visitNode(arrayBufferLength(receiver));
            structuredClone(receiver, { transfer: [receiver] });
            if (!arrayBufferDetached(receiver)) throw new TypeError("ArrayBuffer cannot be detached.");
          }
          return result;
        } finally { release(); }
      }
    })
  });
  Object.defineProperty(prototype, "resize", { writable: true, configurable: true,
    value: createSandboxClosure({ guest: true, sandbox: true, name: "resize", length: 1,
      call: async (args, context) => {
        const receiver = context?.thisValue;
        if (resizeBuffer === undefined || !isSandboxArrayBuffer(receiver) || arrayBufferOptions(receiver) === undefined)
          throw new TypeError("ArrayBuffer resize requires a resizable buffer receiver.");
        const release = retainValues(budget, () => [receiver, ...args]);
        try {
          const number = await sandboxNumber(args[0], budget, context);
          const length = Number.isNaN(number) ? 0 : Math.trunc(number);
          if (!Number.isSafeInteger(length) || length < 0 || length > arrayBufferOptions(receiver)!.maxByteLength)
            throw new RangeError("Invalid ArrayBuffer resize length.");
          budget.allocateArrayLength(length);
          budget.provisionDataUsage(Math.max(length - arrayBufferLength(receiver), 0))();
          Reflect.apply(resizeBuffer, receiver, [length]);
          return undefined;
        } finally { release(); }
      }
    })
  });
  for (const key of ["byteLength", "maxByteLength", "resizable", "detached"] as const) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${key}`, length: 0,
      call: (_args, context) => {
        if (!isSandboxArrayBuffer(context?.thisValue)) throw new TypeError(`ArrayBuffer ${key} requires a buffer receiver.`);
        if (key === "byteLength") return arrayBufferLength(context.thisValue);
        if (key === "detached") return arrayBufferDetached(context.thisValue);
        const options = arrayBufferOptions(context.thisValue);
        return key === "resizable" ? options !== undefined : options?.maxByteLength ?? arrayBufferLength(context.thisValue);
      }
    });
    Object.defineProperty(prototype, key, { get: accessorAdapter(getter, "get"), configurable: true });
    getters.push(getter);
  }
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  arrayBufferPrototypes.set(budget, prototype);
  registerBuiltinIdentities(budget, { ArrayBuffer: constructor });
  registerIntrinsicFunction(budget, constructor);
  for (const getter of getters) registerIntrinsicFunction(budget, getter);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}
import { isNumericTypedArray } from "../typed-array.js";
