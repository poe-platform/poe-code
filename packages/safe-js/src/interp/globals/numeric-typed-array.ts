import type { Budget } from "../budget.js";
import {
  checkTypedArrayAllocation,
  typedArrayNumber,
  typedArrayStorage,
  typedArrayViewLayouts,
  isNumericTypedArray,
  isTypedArrayIndex,
  numericTypedArrayConstructors,
  type NumericTypedArray,
  type NumericTypedArrayConstructor
} from "../typed-array.js";
import { createSandboxClosure, isSandboxClosure, measureSandboxData, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { typedArrayPrototypes } from "../typed-array-prototypes.js";
import { createIntrinsicObject, getBoxedPrototype, getSandboxDataProperty, getSandboxPropertyDescriptor, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { registerBuiltinIdentities, resolveIntrinsicIdentity } from "../intrinsics.js";
import { invokeBuiltinClosure } from "../builtin-call.js";
import { sandboxGetProperty } from "../guest-proxy-get.js";
import { retainValues } from "../resources.js";
import { sandboxNumber, sandboxString } from "../string-coercion.js";
import { acquireSandboxIterator, readIteratorResult, type SandboxIterator } from "../iteration.js";
import { createDataCheckpoint } from "../data-checkpoint.js";
import { createSandboxBox } from "../boxed.js";
import { arrayBufferDetached, arrayBufferLength, arrayBufferOptions, isSandboxArrayBuffer } from "../array-buffer.js";
import { installUint8Hex } from "./uint8-hex.js";
import { installUint8Base64 } from "./uint8-base64.js";
import { budgetedBigInt, sandboxBigInt } from "./bigint.js";
import { float16BackingViews } from "../float16-array.js";

const constructors = new WeakMap<SandboxClosure, NumericTypedArrayConstructor>();

function hasBigIntContent(Native: NumericTypedArrayConstructor): boolean {
  return Native === BigInt64Array || Native === BigUint64Array;
}

function copyTypedArrayElements(target: NumericTypedArray, source: NumericTypedArray, offset: number, budget: Budget): void {
  if (!float16BackingViews.has(target) && !float16BackingViews.has(source)) {
    Reflect.apply(Float32Array.prototype.set, target, [source, offset]);
    return;
  }
  const to = typedArrayStorage(target, true);
  const from = typedArrayStorage(source, true);
  if (hasBigIntContent(to.Native) !== hasBigIntContent(from.Native))
    throw new TypeError("Cannot mix BigInt and Number typed arrays.");
  if (to.Native === from.Native) {
    new Uint8Array(to.buffer, to.byteOffset + offset * to.elementSize, from.length * from.elementSize)
      .set(new Uint8Array(from.buffer, from.byteOffset, from.length * from.elementSize));
    return;
  }
  if (to.buffer === from.buffer) {
    checkTypedArrayAllocation(from.length, budget, from.elementSize);
    const copy = new from.Native(from.length);
    const copyStorage = typedArrayStorage(copy);
    new Uint8Array(copyStorage.buffer).set(new Uint8Array(from.buffer, from.byteOffset, from.length * from.elementSize));
    source = copy;
  }
  for (let index = 0; index < from.length; index++) {
    budget.visitNode();
    target[offset + index] = source[index];
  }
}

export function typedArrayElement(value: SandboxValue, Native: NumericTypedArrayConstructor, budget: Budget, context?: SandboxCallContext): number | Promise<number | bigint> {
  return hasBigIntContent(Native) ? sandboxBigInt(value, budget, context) : sandboxNumber(value, budget, context);
}

export function createNumericTypedArrayGlobal(budget: Budget, nativePrototype = false, Native: NumericTypedArrayConstructor = Float32Array): SandboxClosure {
  const constructor = createSandboxClosure({
    guest: nativePrototype,
    sandbox: true,
    name: Native.name,
    length: 3,
    properties: { BYTES_PER_ELEMENT: Native.BYTES_PER_ELEMENT },
    call: () => {
      throw new TypeError("Constructor Float32Array requires 'new'.");
    },
    construct: (args, context) => {
      if (!nativePrototype) return allocateTypedArray(args[0], budget, Native);
      return (async () => {
        const newTarget = context?.newTarget ?? constructor;
        let candidate: SandboxValue;
        if (context?.getProperty !== undefined) candidate = await context.getProperty(newTarget, "prototype");
        else {
          const callerContext: SandboxCallContext = {
            ...context, stack: context?.stack ?? [], thisValue: undefined,
            getProperty: (value, key) => sandboxGetProperty(value, key, value, budget, bridge)
          };
          const bridge: SandboxCallContext = {
            ...callerContext,
            invokeClosure: context?.invokeClosure ?? ((callee, values, receiver, construct, target) =>
              invokeBuiltinClosure(callee, values, budget, callerContext, receiver, construct, target))
          };
          candidate = await sandboxGetProperty(newTarget, "prototype", newTarget, budget, bridge);
        }
        const prototype = candidate !== null && typeof candidate === "object" ? candidate : getSandboxDataProperty(constructor, "prototype", budget) as SandboxObject;
        const release = retainValues(budget, () => [prototype, ...args]);
        try {
          if (isSandboxArrayBuffer(args[0])) {
            const buffer = args[0];
            const number = await sandboxNumber(args[1], budget, context);
            const offset = Number.isNaN(number) ? 0 : Math.trunc(number);
            if (!Number.isSafeInteger(offset) || offset < 0 || offset % Native.BYTES_PER_ELEMENT !== 0)
              throw new RangeError("Invalid Float32Array buffer offset.");
            let length: number | undefined;
            if (args[2] !== undefined) {
              const size = await sandboxNumber(args[2], budget, context);
              length = Number.isNaN(size) ? 0 : Math.trunc(size);
              if (!Number.isSafeInteger(length) || length < 0)
                throw new RangeError("Invalid Float32Array view length.");
            }
            if (arrayBufferDetached(buffer)) throw new TypeError("Cannot construct Float32Array from a detached ArrayBuffer.");
            const bytes = arrayBufferLength(buffer);
            if (length === undefined) {
              if ((arrayBufferOptions(buffer) === undefined && bytes % Native.BYTES_PER_ELEMENT !== 0) || offset > bytes)
                throw new RangeError("Invalid Float32Array buffer length.");
              length = Math.floor((bytes - offset) / Native.BYTES_PER_ELEMENT);
            } else {
              if (offset + length * Native.BYTES_PER_ELEMENT > bytes)
                throw new RangeError("Invalid Float32Array view length.");
            }
            budget.allocateArrayLength(length);
            const result = new Native(buffer, offset, args[2] === undefined ? undefined : length);
            if (arrayBufferOptions(buffer) !== undefined)
              typedArrayViewLayouts.set(result, { byteOffset: offset, ...(args[2] === undefined ? {} : { length }) });
            setSandboxPrototype(result, prototype, budget);
            return result;
          }
          const result = args[0] !== null && typeof args[0] === "object" && !isNumericTypedArray(args[0])
            ? await allocateTypedArrayInput(args[0], budget, Native, context)
            : allocateTypedArray(args[0], budget, Native);
          setSandboxPrototype(result, prototype, budget);
          return result;
        } finally { release(); }
      })();
    }
  });
  constructors.set(constructor, Native);
  return constructor;
}

async function allocateTypedArrayInput(source: SandboxValue, budget: Budget, Native: NumericTypedArrayConstructor, context?: SandboxCallContext): Promise<NumericTypedArray> {
  const callerContext: SandboxCallContext = {
    ...context, stack: context?.stack ?? [], thisValue: undefined,
    getProperty: context?.getProperty ?? ((value, key) => sandboxGetProperty(value, key, value, budget, bridge))
  };
  const bridge: SandboxCallContext = {
    ...callerContext,
    invokeClosure: context?.invokeClosure ?? ((callee, values, receiver, construct, newTarget) =>
      invokeBuiltinClosure(callee, values, budget, callerContext, receiver, construct, newTarget))
  };
  const values: SandboxValue[] = [];
  let iterator: SandboxIterator | undefined;
  let current: SandboxValue;
  let result: NumericTypedArray | undefined;
  const release = retainValues(budget, () => [source, values, iterator?.retainedValue, current, result]);
  const checkData = createDataCheckpoint(budget, bridge);
  try {
    iterator = await acquireSandboxIterator(source, budget, bridge);
    let length: number;
    if (iterator !== undefined) {
      while (true) {
        budget.visitNode();
        const next = await iterator.next();
        if (typeof next !== "object" || next === null) throw new TypeError("Iterator result must be an object.");
        if ((await readIteratorResult(iterator, next, "done")).value) break;
        current = (await readIteratorResult(iterator, next, "value")).value;
        budget.allocateArrayLength(values.length + 1);
        values.push(current);
        checkData(values, 1 + (budget.limits.dataSize === undefined ? 0 : measureSandboxData([current])));
      }
      length = values.length;
    } else {
      current = await bridge.getProperty!(source, "length");
      const number = await sandboxNumber(current, budget, bridge);
      length = Number.isNaN(number) || number <= 0 ? 0 : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
    }
    checkTypedArrayAllocation(length, budget, Native.BYTES_PER_ELEMENT);
    result = new Native(length);
    checkData(result, 0, true);
    for (let index = 0; index < length; index++) {
      budget.visitNode();
      current = iterator === undefined ? await bridge.getProperty!(source, String(index)) : values[index];
      result[index] = await typedArrayElement(current, Native, budget, bridge);
    }
    return result;
  } finally { release(); }
}

function allocateTypedArray(source: SandboxValue, budget: Budget, Native: NumericTypedArrayConstructor): NumericTypedArray {
      if (Array.isArray(source) || isNumericTypedArray(source)) {
        const length = isNumericTypedArray(source) ? typedArrayStorage(source).length : source.length;
        checkTypedArrayAllocation(length, budget, Native.BYTES_PER_ELEMENT);
        if (isNumericTypedArray(source)) {
          typedArrayStorage(source, true);
          const result = new Native(length);
          copyTypedArrayElements(result, source, 0, budget);
          return result;
        }
        const result = new Native(length);
        for (let index = 0; index < length; index += 1) {
          budget.visitNode();
          const descriptor = Object.getOwnPropertyDescriptor(source, index);
          if (descriptor !== undefined && !("value" in descriptor))
            throw new TypeError("Float32Array input accessors are not supported.");
          const value = descriptor?.value;
          result[index] = hasBigIntContent(Native) ? budgetedBigInt(value, budget) : typedArrayNumber(value);
        }
        return result;
      }
      const number = typedArrayNumber(source);
      const length = Number.isNaN(number) ? 0 : Math.trunc(number);
      if (length < 0 || !Number.isSafeInteger(length))
        throw new RangeError("Invalid typed array length.");
      checkTypedArrayAllocation(length, budget, Native.BYTES_PER_ELEMENT);
      return new Native(length);
}

export function createNumericTypedArrayPrototypes(budget: Budget, bindings: Record<keyof typeof numericTypedArrayConstructors, SandboxClosure>): void {
  const shared = createIntrinsicObject();
  const abstractCall = () => { throw new TypeError("Abstract TypedArray constructor cannot be called."); };
  const typedArray = createSandboxClosure({ guest: true, sandbox: true, name: "TypedArray", length: 0,
    call: abstractCall, construct: abstractCall });
  Object.defineProperty(materializeFunctionProperties(typedArray), "prototype", { value: shared, writable: false });
  Object.defineProperty(materializeFunctionProperties(typedArray), "from", {
    writable: true, configurable: true,
    value: createSandboxClosure({ guest: true, sandbox: true, name: "from", length: 1,
      call: async (args, context) => {
        const target = context?.thisValue;
        const [source, mapper, receiver] = args;
        if (!isSandboxClosure(target) || target.construct === undefined)
          throw new TypeError("TypedArray.from requires a constructor receiver.");
        if (mapper !== undefined && !isSandboxClosure(mapper))
          throw new TypeError("TypedArray.from mapper must be callable.");
        if (source === null || source === undefined)
          throw new TypeError("TypedArray.from requires a non-null source.");
        const callerContext: SandboxCallContext = {
          ...context, stack: context?.stack ?? [], thisValue: target,
          getProperty: context?.getProperty ?? ((value, key) => sandboxGetProperty(value, key, value, budget, context))
        };
        context = {
          ...callerContext,
          invokeClosure: callerContext.invokeClosure ?? ((callee, values, thisValue, construct, newTarget) =>
            invokeBuiltinClosure(callee, values, budget, callerContext, thisValue, construct, newTarget))
        };
        let result: SandboxValue;
        let current: SandboxValue;
        let iterator: SandboxIterator | undefined;
        const values: SandboxValue[] = [];
        const release = retainValues(budget, () => [target, result, current, iterator?.retainedValue, values, ...args]);
        const checkData = createDataCheckpoint(budget, context);
        const read = (key: string) => context?.getProperty === undefined
          ? getSandboxDataProperty(source, key, budget) : context.getProperty(source, key);
        try {
          iterator = await acquireSandboxIterator(source, budget, context);
          let length: number;
          if (iterator !== undefined) {
            while (true) {
              budget.visitNode();
              const next = await iterator.next();
              if (typeof next !== "object" || next === null) throw new TypeError("Iterator result must be an object.");
              if ((await readIteratorResult(iterator, next, "done")).value) break;
              current = (await readIteratorResult(iterator, next, "value")).value;
              budget.allocateArrayLength(values.length + 1);
              values.push(current);
              checkData(values, 1 + (budget.limits.dataSize === undefined ? 0 : measureSandboxData([current])));
            }
            length = values.length;
          } else {
            const number = await sandboxNumber(await read("length"), budget, context);
            length = Number.isNaN(number) || number <= 0 ? 0 : Math.min(Math.trunc(number), Number.MAX_SAFE_INTEGER);
          }
          result = await invokeBuiltinClosure(target, [length], budget, context, undefined, true);
          if (!isNumericTypedArray(result) || typedArrayStorage(result).length < length)
            throw new TypeError("TypedArray.from constructor must return sufficient typed storage.");
          checkData(result, 0, true);
          for (let index = 0; index < length; index++) {
            budget.visitNode();
            current = iterator === undefined ? await read(String(index)) : values[index];
            if (mapper !== undefined)
              current = await invokeBuiltinClosure(mapper, [current, index], budget, context, receiver);
            result[index] = await typedArrayElement(current, typedArrayStorage(result).Native, budget, context);
          }
          return result;
        } finally { release(); }
      }
    })
  });
  Object.defineProperty(materializeFunctionProperties(typedArray), "of", {
    writable: true, configurable: true,
    value: createSandboxClosure({ guest: true, sandbox: true, name: "of", length: 0,
      call: async (args, context) => {
        const target = context?.thisValue;
        if (!isSandboxClosure(target) || target.construct === undefined)
          throw new TypeError("TypedArray.of requires a constructor receiver.");
        const callerContext: SandboxCallContext = {
          ...context, stack: context?.stack ?? [], thisValue: target,
          getProperty: context?.getProperty ?? ((value, key) => sandboxGetProperty(value, key, value, budget, context))
        };
        context = {
          ...callerContext,
          invokeClosure: callerContext.invokeClosure ?? ((callee, values, receiver, construct, newTarget) =>
            invokeBuiltinClosure(callee, values, budget, callerContext, receiver, construct, newTarget))
        };
        let result: SandboxValue;
        const release = retainValues(budget, () => [target, result, ...args]);
        try {
          result = await invokeBuiltinClosure(target, [args.length], budget, context, undefined, true);
          if (!isNumericTypedArray(result) || typedArrayStorage(result).length < args.length)
            throw new TypeError("TypedArray.of constructor must return sufficient typed storage.");
          for (let index = 0; index < args.length; index++) {
            budget.visitNode();
            result[index] = await typedArrayElement(args[index], typedArrayStorage(result).Native, budget, context);
          }
          return result;
        } finally { release(); }
      }
    })
  });
  const prototypes = new Map<NumericTypedArrayConstructor, SandboxObject>();
  for (const [name, Native] of Object.entries(numericTypedArrayConstructors)) {
    const constructor = bindings[name as keyof typeof bindings];
    const prototype = createIntrinsicObject();
    Object.defineProperties(materializeFunctionProperties(constructor), {
      prototype: { value: prototype, writable: false },
      BYTES_PER_ELEMENT: { value: Native.BYTES_PER_ELEMENT, writable: false, enumerable: false, configurable: false }
    });
    Object.defineProperties(prototype, {
      constructor: { value: constructor, writable: true, configurable: true },
      BYTES_PER_ELEMENT: { value: Native.BYTES_PER_ELEMENT }
    });
    setSandboxPrototype(constructor, typedArray);
    setSandboxPrototype(prototype, shared);
    prototypes.set(Native, prototype);
  }
  installUint8Hex(budget, bindings.Uint8Array, prototypes.get(Uint8Array)!);
  installUint8Base64(budget, bindings.Uint8Array, prototypes.get(Uint8Array)!);
  for (const [name, Native] of Object.entries(numericTypedArrayConstructors)) {
    registerIntrinsicFunction(budget, bindings[name as keyof typeof bindings]);
    registerIntrinsicObject(budget, prototypes.get(Native)!);
  }
  Object.defineProperty(shared, "constructor", { value: typedArray, writable: true, configurable: true });
  setSandboxPrototype(shared, getSandboxPrototype(Object.create(null), budget));
  const getters: SandboxClosure[] = [];
  const species = createSandboxClosure({ guest: true, sandbox: true, name: "get [Symbol.species]", length: 0,
    call: (_args, context) => context?.thisValue });
  getters.push(species);
  Object.defineProperty(materializeFunctionProperties(typedArray), Symbol.species, {
    get: accessorAdapter(species, "get"), configurable: true
  });
  for (const key of ["length", "byteLength", "byteOffset", "buffer"] as const) {
    const getter = createSandboxClosure({ guest: true, sandbox: true, name: `get ${key}`, length: 0,
      call: (_args, context) => {
        if (!isNumericTypedArray(context?.thisValue)) throw new TypeError(`TypedArray ${key} requires a typed array receiver.`);
        const storage = typedArrayStorage(context.thisValue);
        return key === "byteLength" ? storage.length * storage.elementSize : storage[key];
      }
    });
    getters.push(getter);
    Object.defineProperty(shared, key, { get: accessorAdapter(getter, "get"), configurable: true });
  }
  for (const key of ["set", "slice", "subarray", "fill", "copyWithin", "reverse", "toReversed", "at", "includes", "indexOf", "lastIndexOf", "forEach", "every", "some", "find", "findIndex", "findLast", "findLastIndex", "sort", "toSorted", "with", "reduce", "reduceRight", "map", "filter", "toLocaleString"])
    Object.defineProperty(shared, key, { value: getTypedArrayMember(new Float32Array(0), key, budget, bindings), writable: true, configurable: true });
  const arrayPrototype = resolveIntrinsicIdentity(budget, '["Array","prototype"]') as SandboxObject;
  Object.defineProperty(shared, "toString", { value: getSandboxDataProperty(arrayPrototype, "toString", budget), writable: true, configurable: true });
  Object.defineProperty(shared, "join", { writable: true, configurable: true,
    value: createSandboxClosure({ guest: true, sandbox: true, name: "join", length: 1,
      call: async (args, context) => {
        if (!isNumericTypedArray(context?.thisValue)) throw new TypeError("TypedArray join requires a typed array receiver.");
        const receiver = context.thisValue;
        const length = typedArrayStorage(receiver, true).length;
        let separator = ",";
        let text = "";
        const release = retainValues(budget, () => [receiver, separator, text, ...args]);
        try {
          if (args[0] !== undefined) separator = await sandboxString(args[0], budget, context);
          for (let index = 0; index < length; index++) {
            budget.visitNode();
            const value = receiver[index];
            text = budget.allocateString(text + (index === 0 ? "" : separator) + (value === undefined ? "" : String(value)));
          }
          return text;
        } finally { release(); }
      }
    })
  });
  const tagGetter = createSandboxClosure({ guest: true, sandbox: true, name: "get [Symbol.toStringTag]", length: 0,
    call: (_args, context) => isNumericTypedArray(context?.thisValue) ? typedArrayStorage(context.thisValue).Native.name : undefined });
  getters.push(tagGetter);
  Object.defineProperty(shared, Symbol.toStringTag, { get: accessorAdapter(tagGetter, "get"), configurable: true });
  for (const key of ["values", "keys", "entries"] as const) {
    const method = getSandboxDataProperty(arrayPrototype, key, budget) as SandboxClosure;
    const closure = createSandboxClosure({ guest: true, sandbox: true, name: key, length: 0,
      call: (args, context) => {
        if (!isNumericTypedArray(context?.thisValue)) throw new TypeError(`TypedArray ${key} requires a typed array receiver.`);
        typedArrayStorage(context.thisValue, true);
        return invokeBuiltinClosure(method, args, budget, context, context.thisValue);
      }
    });
    Object.defineProperty(shared, key, { value: closure, writable: true, configurable: true });
    if (key === "values") Object.defineProperty(shared, Symbol.iterator, { value: closure, writable: true, configurable: true });
  }
  typedArrayPrototypes.set(budget, prototypes);
  registerBuiltinIdentities(budget, { ...bindings, "%TypedArray%": typedArray });
  registerIntrinsicFunction(budget, typedArray);
  registerIntrinsicObject(budget, shared);
  for (const getter of getters) registerIntrinsicFunction(budget, getter);
}

export function numericTypedArrayConstructor(value: unknown): NumericTypedArrayConstructor | undefined {
  return typeof value === "object" && value !== null ? constructors.get(value as SandboxClosure) : undefined;
}

export function getTypedArrayMember(
  value: NumericTypedArray,
  property: string | number,
  budget: Budget,
  bindings?: Record<keyof typeof numericTypedArrayConstructors, SandboxClosure>
): SandboxValue {
  const key = String(property);
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor !== undefined) {
    if (!("value" in descriptor)) throw new TypeError("Float32Array accessors are not supported.");
    return descriptor.value;
  }
  if (typedArrayPrototypes.has(budget)) return undefined;
  const storage = typedArrayStorage(value);
  if (key === "length") return storage.length;
  if (key === "byteLength") return storage.length * storage.elementSize;
  if (key === "byteOffset") return storage.byteOffset;
  if (key === "BYTES_PER_ELEMENT") return storage.elementSize;
  if (!["set", "slice", "subarray", "fill", "copyWithin", "reverse", "toReversed", "at", "includes", "indexOf", "lastIndexOf", "forEach", "every", "some", "find", "findIndex", "findLast", "findLastIndex", "sort", "toSorted", "with", "reduce", "reduceRight", "map", "filter", "toLocaleString"].includes(key)) return undefined;
  const numberPrototype = key === "toLocaleString" ? getBoxedPrototype(0, budget) : undefined;
  const bigintPrototype = key === "toLocaleString" ? getBoxedPrototype(0n, budget) : undefined;
  return createSandboxClosure({
    guest: true,
    sandbox: true,
    name: key,
    length: key === "reverse" || key === "toReversed" || key === "toLocaleString" ? 0 : key === "sort" || key === "toSorted" || key === "reduce" || key === "reduceRight" || key === "map" || key === "filter" || key === "set" || key === "fill" || key === "at" || key === "includes" || key === "indexOf" || key === "lastIndexOf" || key === "forEach" || key === "every" || key === "some" || key === "find" || key === "findIndex" || key === "findLast" || key === "findLastIndex" ? 1 : 2,
    call: (args, context) => {
      if ((key === "sort" || key === "toSorted") && args[0] !== undefined && !isSandboxClosure(args[0]))
        throw new TypeError("TypedArray sort comparator must be callable.");
      const receiver = context?.thisValue;
      if (!isNumericTypedArray(receiver))
        throw new TypeError(`Float32Array#${key} requires a Float32Array receiver.`);
      const storage = typedArrayStorage(receiver, key === "sort" || key === "toSorted" || key === "with" || key === "reduce" || key === "reduceRight" || key === "map" || key === "filter" || key === "slice" || key === "fill" || key === "copyWithin" || key === "reverse" || key === "toReversed" || key === "at" || key === "includes" || key === "indexOf" || key === "lastIndexOf" || key === "forEach" || key === "every" || key === "some" || key === "find" || key === "findIndex" || key === "findLast" || key === "findLastIndex" || key === "toLocaleString");
      const elementPrototype = hasBigIntContent(storage.Native) ? bigintPrototype : numberPrototype;
      const defaultConstructor = bindings?.[storage.Native.name as keyof typeof bindings];
      const prototypeValue = defaultConstructor === undefined ? undefined : getSandboxDataProperty(defaultConstructor, "prototype", budget);
      const resultPrototype = prototypeValue !== null && typeof prototypeValue === "object" ? prototypeValue : undefined;
      if (key === "toReversed") {
        let result: NumericTypedArray | undefined;
        const release = retainValues(budget, () => [receiver, result, ...args]);
        try {
          checkTypedArrayAllocation(storage.length, budget, storage.elementSize);
          result = new storage.Native(storage.length);
          if (resultPrototype !== undefined) setSandboxPrototype(result, resultPrototype, budget);
          createDataCheckpoint(budget, context)(result, 0, true);
          for (let index = 0; index < storage.length; index++) {
            budget.visitNode();
            result[index] = receiver[storage.length - index - 1]!;
          }
          return result;
        } finally { release(); }
      }
      if (key === "reverse") {
        const release = retainValues(budget, () => [receiver, ...args]);
        try {
          const bytes = new Uint8Array(storage.buffer, storage.byteOffset, storage.length * storage.elementSize);
          for (let lower = 0; lower < Math.floor(storage.length / 2); lower++) {
            const upper = storage.length - lower - 1;
            for (let offset = 0; offset < storage.elementSize; offset++) {
              budget.visitNode();
              const saved = bytes[lower * storage.elementSize + offset];
              bytes[lower * storage.elementSize + offset] = bytes[upper * storage.elementSize + offset];
              bytes[upper * storage.elementSize + offset] = saved;
            }
          }
          return receiver;
        } finally { release(); }
      }
      const callerContext: SandboxCallContext = {
        ...context, stack: context?.stack ?? [], thisValue: receiver,
        getProperty: context?.getProperty ?? ((value, property) => sandboxGetProperty(value, property, value, budget, bridge))
      };
      const bridge: SandboxCallContext = {
        ...callerContext,
        invokeClosure: context?.invokeClosure ?? ((callee, values, thisValue, construct, newTarget) =>
          invokeBuiltinClosure(callee, values, budget, callerContext, thisValue, construct, newTarget))
      };
      if (key === "sort" || key === "toSorted") {
        const comparator = args[0] as SandboxClosure | undefined;
        if (key === "sort" && storage.length < 2) return receiver;
        return (async () => {
          let items: NumericTypedArray | undefined;
          let scratch: NumericTypedArray | undefined;
          let comparisonResult: SandboxValue;
          const release = retainValues(budget, () => [receiver, items, scratch, comparisonResult, ...args]);
          const checkData = createDataCheckpoint(budget, bridge);
          try {
            checkTypedArrayAllocation(storage.length, budget, storage.elementSize);
            items = new storage.Native(storage.length);
            if (key === "toSorted" && resultPrototype !== undefined) setSandboxPrototype(items, resultPrototype, budget);
            checkData(items, 0, true);
            for (let index = 0; index < storage.length; index++) {
              budget.visitNode();
              items[index] = receiver[index]!;
            }
            if (storage.length < 2) return items;
            checkTypedArrayAllocation(storage.length, budget, storage.elementSize);
            scratch = new storage.Native(storage.length);
            checkData(scratch, 0, true);
            for (let width = 1; width < storage.length; width *= 2) {
              for (let start = 0; start < storage.length; start += width * 2) {
                const middle = Math.min(start + width, storage.length);
                const end = Math.min(start + width * 2, storage.length);
                let left = start;
                let right = middle;
                for (let output = start; output < end; output++) {
                  budget.visitNode();
                  let takeLeft = right === end;
                  if (left < middle && right < end) {
                    const a = items[left]!;
                    const b = items[right]!;
                    let order: number;
                    if (comparator !== undefined) {
                      comparisonResult = await invokeBuiltinClosure(comparator, [a, b], budget, bridge, undefined);
                      order = await sandboxNumber(comparisonResult, budget, bridge);
                      if (Number.isNaN(order)) order = 0;
                    } else if (Number.isNaN(a)) order = Number.isNaN(b) ? 0 : 1;
                    else if (Number.isNaN(b)) order = -1;
                    else if (a === 0 && b === 0) order = Object.is(a, -0) ? Object.is(b, -0) ? 0 : -1 : Object.is(b, -0) ? 1 : 0;
                    else order = a < b ? -1 : a > b ? 1 : 0;
                    takeLeft = order <= 0;
                  }
                  scratch[output] = takeLeft ? items[left++]! : items[right++]!;
                }
              }
              const previous: NumericTypedArray = items;
              items = scratch;
              scratch = previous;
            }
            if (key === "toSorted") return items;
            for (let index = 0; index < storage.length; index++) {
              budget.visitNode();
              receiver[index] = items[index]!;
            }
            return receiver;
          } finally { release(); }
        })();
      }
      if (key === "toLocaleString") {
        return (async () => {
          let text = "";
          const release = retainValues(budget, () => [receiver, text, ...args]);
          try {
            for (let index = 0; index < storage.length; index++) {
              budget.visitNode();
              const element = receiver[index];
              let part = "";
              if (element !== undefined) {
                const descriptor = context?.getProperty === undefined && elementPrototype !== undefined
                  ? getSandboxPropertyDescriptor(elementPrototype, "toLocaleString", budget) : undefined;
                const method = context?.getProperty === undefined && elementPrototype !== undefined
                  ? descriptor === undefined ? undefined : await readPropertyDescriptor(descriptor, element, bridge)
                  : await bridge.getProperty!(element, "toLocaleString");
                if (!isSandboxClosure(method)) throw new TypeError("Element toLocaleString must be callable.");
                const converted = await invokeBuiltinClosure(method, [args[0], args[1]], budget, bridge, element);
                part = await sandboxString(converted, budget, bridge);
              }
              text = budget.allocateString(text + (index === 0 ? "" : ",") + part);
            }
            return text;
          } finally { release(); }
        })();
      }
      if (key === "reduce" || key === "reduceRight") {
        const callback = args[0];
        if (!isSandboxClosure(callback)) throw new TypeError(`Float32Array#${key} callback must be callable.`);
        const hasInitialValue = args.length > 1;
        if (!hasInitialValue && storage.length === 0) throw new TypeError("Reduce of empty typed array with no initial value.");
        const backwards = key === "reduceRight";
        const first = backwards ? storage.length - 1 : 0;
        let accumulator = hasInitialValue ? args[1] : receiver[first];
        return (async () => {
          const release = retainValues(budget, () => [receiver, accumulator, ...args]);
          try {
            for (let index = hasInitialValue ? first : first + (backwards ? -1 : 1); backwards ? index >= 0 : index < storage.length; index += backwards ? -1 : 1) {
              budget.visitNode();
              accumulator = await invokeBuiltinClosure(callback, [accumulator, receiver[index], index, receiver], budget, bridge, undefined);
            }
            return accumulator;
          } finally { release(); }
        })();
      }
      if (key === "forEach" || key === "every" || key === "some" || key === "find" || key === "findIndex" || key === "findLast" || key === "findLastIndex") {
        const callback = args[0];
        if (!isSandboxClosure(callback)) throw new TypeError(`Float32Array#${key} callback must be callable.`);
        return (async () => {
          const release = retainValues(budget, () => [receiver, ...args]);
          try {
            const backwards = key === "findLast" || key === "findLastIndex";
            for (let index = backwards ? storage.length - 1 : 0; backwards ? index >= 0 : index < storage.length; index += backwards ? -1 : 1) {
              budget.visitNode();
              const element = receiver[index];
              const result = await invokeBuiltinClosure(callback, [element, index, receiver], budget, bridge, args[1]);
              if (key === "every" && !result) return false;
              if (key === "some" && result) return true;
              if ((key === "find" || key === "findLast") && result) return element;
              if ((key === "findIndex" || key === "findLastIndex") && result) return index;
            }
            return key === "findIndex" || key === "findLastIndex" ? -1 : key === "forEach" || key === "find" || key === "findLast" ? undefined : key === "every";
          } finally { release(); }
        })();
      }
      if (key === "includes" || key === "indexOf" || key === "lastIndexOf") {
        const notFound = key === "includes" ? false : -1;
        if (storage.length === 0) return notFound;
        return (async () => {
          const release = retainValues(budget, () => [receiver, ...args]);
          try {
            const backwards = key === "lastIndexOf";
            const numeric = backwards && args.length < 2 ? storage.length - 1
              : await sandboxNumber(args[1], budget, bridge);
            let start = relativeIndex(numeric, storage.length);
            if (backwards) {
              const integer = Number.isNaN(numeric) ? 0 : Math.trunc(numeric);
              start = integer < 0 ? storage.length + integer : Math.min(integer, storage.length - 1);
            }
            for (let index = start; backwards ? index >= 0 : index < storage.length; index += backwards ? -1 : 1) {
              budget.visitNode();
              if (key !== "includes" && !(index in receiver)) continue;
              const element = receiver[index];
              if (element === args[0] || (key === "includes" && Number.isNaN(element) && Number.isNaN(args[0])))
                return key === "includes" ? true : index + 0;
            }
            return notFound;
          } finally { release(); }
        })();
      }
      if (key === "with") {
        return (async () => {
          let result: NumericTypedArray | undefined;
          const release = retainValues(budget, () => [receiver, result, ...args]);
          try {
            const number = await sandboxNumber(args[0], budget, bridge);
            const relative = Number.isNaN(number) ? 0 : Math.trunc(number);
            const index = relative < 0 ? storage.length + relative : relative;
            const replacement = await typedArrayElement(args[1], storage.Native, budget, bridge);
            if (index < 0 || index >= typedArrayStorage(receiver).length)
              throw new RangeError("Float32Array#with index is out of bounds.");
            checkTypedArrayAllocation(storage.length, budget, storage.elementSize);
            result = new storage.Native(storage.length);
            if (resultPrototype !== undefined) setSandboxPrototype(result, resultPrototype, budget);
            createDataCheckpoint(budget, bridge)(result, 0, true);
            for (let offset = 0; offset < storage.length; offset++) {
              budget.visitNode();
              result[offset] = offset === index ? replacement : receiver[offset]!;
            }
            return result;
          } finally { release(); }
        })();
      }
      if (key === "at") {
        return (async () => {
          const release = retainValues(budget, () => [receiver, ...args]);
          try {
            const number = await sandboxNumber(args[0], budget, bridge);
            const relative = Number.isNaN(number) ? 0 : Math.trunc(number);
            const index = relative < 0 ? storage.length + relative : relative;
            return index < 0 || index >= storage.length ? undefined : receiver[index];
          } finally { release(); }
        })();
      }
      if (key === "copyWithin") {
        return (async () => {
          const release = retainValues(budget, () => [receiver, ...args]);
          try {
            const target = relativeIndex(await sandboxNumber(args[0], budget, bridge), storage.length);
            const start = relativeIndex(await sandboxNumber(args[1], budget, bridge), storage.length);
            const end = args[2] === undefined ? storage.length
              : relativeIndex(await sandboxNumber(args[2], budget, bridge), storage.length);
            let count = Math.min(end - start, storage.length - target);
            if (count > 0) {
              const current = typedArrayStorage(receiver, true);
              count = Math.min(count, current.length - start, current.length - target);
              if (count > 0) {
                const bytes = new Uint8Array(current.buffer, current.byteOffset, current.length * storage.elementSize);
                const direction = start < target && target < start + count ? -1 : 1;
                let from = start * storage.elementSize + (direction < 0 ? count * storage.elementSize - 1 : 0);
                let to = target * storage.elementSize + (direction < 0 ? count * storage.elementSize - 1 : 0);
                for (let remaining = count * storage.elementSize; remaining > 0; remaining--) {
                  budget.visitNode();
                  bytes[to] = bytes[from];
                  from += direction;
                  to += direction;
                }
              }
            }
            return receiver;
          } finally { release(); }
        })();
      }
      if (key === "fill") {
        return (async () => {
          const release = retainValues(budget, () => [receiver, ...args]);
          try {
            const value = await typedArrayElement(args[0], storage.Native, budget, bridge);
            const start = relativeIndex(await sandboxNumber(args[1], budget, bridge), storage.length);
            const end = args[2] === undefined ? storage.length
              : relativeIndex(await sandboxNumber(args[2], budget, bridge), storage.length);
            const current = typedArrayStorage(receiver, true);
            for (let index = start; index < Math.min(end, current.length); index++) {
              budget.visitNode();
              receiver[index] = value;
            }
            return receiver;
          } finally { release(); }
        })();
      }
      if (key === "set") {
        return (async () => {
          const [source, offsetValue = 0] = args;
          let current: SandboxValue;
          let sourceObject: SandboxValue;
          const release = retainValues(budget, () => [receiver, sourceObject, current, ...args]);
          try {
            const number = await sandboxNumber(offsetValue, budget, bridge);
            const offset = Number.isNaN(number) ? 0 : Math.trunc(number);
            if (offset < 0) throw new RangeError("Float32Array#set offset is out of bounds.");
            const targetStorage = typedArrayStorage(receiver, true);
            if (source === null || source === undefined) throw new TypeError("Float32Array#set requires a non-null source.");
            let length: number;
            if (isNumericTypedArray(source)) length = typedArrayStorage(source, true).length;
            else {
              sourceObject = typeof source === "object" ? source : createSandboxBox(source);
              current = await bridge.getProperty!(sourceObject, "length");
              const size = await sandboxNumber(current, budget, bridge);
              length = Number.isNaN(size) || size <= 0 ? 0 : Math.min(Math.trunc(size), Number.MAX_SAFE_INTEGER);
            }
            if (offset + length > targetStorage.length) throw new RangeError("Float32Array#set source is out of bounds.");
            if (isNumericTypedArray(source)) copyTypedArrayElements(receiver, source, offset, budget);
            else for (let index = 0; index < length; index++) {
              budget.visitNode();
              current = await bridge.getProperty!(sourceObject, String(index));
              receiver[offset + index] = await typedArrayElement(current, targetStorage.Native, budget, bridge);
            }
            return undefined;
          } finally { release(); }
        })();
      }
      const callback = key === "map" || key === "filter" ? args[0] : undefined;
      if ((key === "map" || key === "filter") && !isSandboxClosure(callback)) throw new TypeError(`Float32Array#${key} callback must be callable.`);
      return (async () => {
        let candidate: SandboxValue;
        let result: SandboxValue;
        let mapped: SandboxValue;
        const kept: Array<number | bigint | undefined> = [];
        const release = retainValues(budget, () => [receiver, candidate, result, mapped, kept, ...args]);
        try {
          const start = key === "map" || key === "filter" ? 0 : relativeIndex(await sandboxNumber(args[0], budget, bridge), storage.length);
          const end = key === "map" || key === "filter" || args[1] === undefined ? storage.length
            : relativeIndex(await sandboxNumber(args[1], budget, bridge), storage.length);
          let length = Math.max(end - start, 0);
          if (key === "filter") {
            const checkData = createDataCheckpoint(budget, bridge);
            for (let index = 0; index < length; index++) {
              budget.visitNode();
              const element = receiver[index];
              const selected = await invokeBuiltinClosure(callback as SandboxClosure, [element, index, receiver], budget, bridge, args[1]);
              if (selected) {
                budget.allocateArrayLength(kept.length + 1);
                kept.push(element);
                checkData(kept, 1 + (budget.limits.dataSize === undefined ? 0 : measureSandboxData([element])));
              }
            }
            length = kept.length;
          }
          const layout = typedArrayViewLayouts.get(receiver);
          const offset = (layout?.byteOffset ?? storage.byteOffset) + start * storage.elementSize;
          const tracking = layout !== undefined && layout.length === undefined && args[1] === undefined;
          if (defaultConstructor !== undefined) {
            candidate = await bridge.getProperty!(receiver, "constructor");
            if (candidate !== undefined) {
              if (candidate === null || typeof candidate !== "object")
                throw new TypeError("TypedArray constructor must be an object.");
              candidate = await bridge.getProperty!(candidate, Symbol.species);
              if (candidate !== undefined && candidate !== null &&
                  (!isSandboxClosure(candidate) || candidate.construct === undefined))
                throw new TypeError("TypedArray species must be a constructor.");
            }
          }
          if (candidate !== undefined && candidate !== null && candidate !== defaultConstructor) {
            const values: SandboxValue[] = key !== "subarray" ? [length]
              : [storage.buffer, offset, tracking ? undefined : length];
            result = await invokeBuiltinClosure(candidate as SandboxClosure, values, budget, bridge, undefined, true);
            if (!isNumericTypedArray(result)) throw new TypeError("TypedArray species must return typed storage.");
            const target = typedArrayStorage(result, key !== "subarray");
            if (hasBigIntContent(target.Native) !== hasBigIntContent(storage.Native))
              throw new TypeError("TypedArray species must preserve content type.");
            if (key !== "subarray" && target.length < length)
              throw new TypeError("TypedArray species returned insufficient storage.");
          }
          if (key === "subarray") {
            if (result === undefined) {
              result = new storage.Native(storage.buffer, offset, tracking ? undefined : length);
              if (resultPrototype !== undefined) setSandboxPrototype(result, resultPrototype, budget);
              if (arrayBufferOptions(storage.buffer) !== undefined)
                typedArrayViewLayouts.set(result, { byteOffset: offset, ...(tracking ? {} : { length }) });
            }
            return result;
          }
          if (result === undefined) {
            checkTypedArrayAllocation(length, budget, storage.elementSize);
            result = new storage.Native(length);
            if (resultPrototype !== undefined) setSandboxPrototype(result, resultPrototype, budget);
          }
          if (!isNumericTypedArray(result)) throw new TypeError("TypedArray species must return typed storage.");
          if (key === "filter") {
            for (let index = 0; index < length; index++) {
              budget.visitNode();
              result[index] = kept[index] ?? NaN;
            }
            return result;
          }
          if (key === "map") {
            for (let index = 0; index < length; index++) {
              budget.visitNode();
              mapped = await invokeBuiltinClosure(callback as SandboxClosure, [receiver[index], index, receiver], budget, bridge, args[1]);
              result[index] = await typedArrayElement(mapped, typedArrayStorage(result).Native, budget, bridge);
            }
            return result;
          }
          if (length > 0) {
            const current = typedArrayStorage(receiver, true);
            const target = typedArrayStorage(result, true);
            const count = Math.min(length, Math.max(current.length - start, 0));
            if (count > 0 && current.Native !== target.Native) {
              for (let index = 0; index < count; index++) {
                budget.visitNode();
                result[index] = receiver[start + index]!;
              }
            } else if (count > 0) {
              const sourceBytes = new Uint8Array(current.buffer, current.byteOffset + start * storage.elementSize, count * storage.elementSize);
              const targetBytes = new Uint8Array(target.buffer, target.byteOffset, count * storage.elementSize);
              if (current.buffer === target.buffer && targetBytes.byteOffset > sourceBytes.byteOffset &&
                  targetBytes.byteOffset < sourceBytes.byteOffset + sourceBytes.length) {
                for (let index = 0; index < sourceBytes.length; index++) {
                  budget.visitNode();
                  targetBytes[index] = sourceBytes[index]!;
                }
              } else targetBytes.set(sourceBytes);
            }
          }
          return result;
        } finally { release(); }
      })();
    }
  });
}

export function setTypedArrayMember(
  value: NumericTypedArray,
  property: PropertyKey,
  entry: SandboxValue,
  budget: Budget,
  context?: SandboxCallContext
): void | Promise<void> {
  const key = typeof property === "symbol" ? property : String(property);
  if (typeof key !== "symbol" && isTypedArrayIndex(key)) {
    return (async () => {
      const release = retainValues(budget, () => [value, entry]);
      try {
        const number = await typedArrayElement(entry, typedArrayStorage(value).Native, budget, context);
        Reflect.set(value, key, number);
      } finally { release(); }
    })();
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  const inherited = descriptor ?? getSandboxPropertyDescriptor(value, key, budget);
  if (
    descriptor === undefined && typeof key === "string" &&
    !typedArrayPrototypes.has(budget) &&
    ["length", "byteLength", "byteOffset", "buffer", "BYTES_PER_ELEMENT"].includes(key)
  )
    throw new TypeError(`Cannot assign to read only property '${String(key)}'.`);
  if (inherited !== undefined && (!("value" in inherited) || !inherited.writable))
    throw new TypeError(`Cannot assign to read only property '${String(key)}'.`);
  Object.defineProperty(
    value,
    key,
    descriptor === undefined
      ? { value: entry, configurable: true, enumerable: true, writable: true }
      : { value: entry }
  );
}

function relativeIndex(numeric: number, length: number): number {
  const integer = Number.isNaN(numeric) ? 0 : Math.trunc(numeric);
  return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length);
}
