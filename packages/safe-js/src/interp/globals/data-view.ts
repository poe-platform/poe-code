import type { Budget } from "../budget.js";
import { getFunctionRealmPrototype } from "../function-realm.js";
import { arrayBufferDetached, arrayBufferLength, arrayBufferOptions, isSandboxArrayBuffer } from "../array-buffer.js";
import { isSandboxSharedArrayBuffer } from "../shared-array-buffer.js";
import { dataViewGetters, dataViewLayouts, dataViewPrototypes, isSandboxDataView } from "../data-view.js";
import { accessorAdapter, readPropertyDescriptor } from "../accessors.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject, type SandboxValue } from "../values.js";
import { createIntrinsicObject, getSandboxPropertyDescriptor, getSandboxPrototype, materializeFunctionProperties, registerIntrinsicFunction, registerIntrinsicObject, setSandboxPrototype } from "../object-model.js";
import { registerBuiltinIdentities } from "../intrinsics.js";
import { sandboxNumber } from "../string-coercion.js";
import { retainValues } from "../resources.js";
import { sandboxBigInt } from "./bigint.js";
import { f16round } from "./math.js";

const methods = Object.fromEntries(["Int8", "Uint8", "Int16", "Uint16", "Int32", "Uint32", "Float32", "Float64", "BigInt64", "BigUint64"].flatMap(type =>
  ["get", "set"].map(operation => [operation + type, Object.getOwnPropertyDescriptor(DataView.prototype, operation + type)!.value]))) as Record<string, (...args: unknown[]) => unknown>;
const readUint16 = DataView.prototype.getUint16;
const writeUint16 = DataView.prototype.setUint16;
methods.getFloat16 = function (this: DataView, ...args: unknown[]) {
  const bits = Reflect.apply(readUint16, this, args);
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31, fraction = bits & 1023;
  if (exponent === 31) return fraction === 0 ? sign * Infinity : NaN;
  return sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15));
};
methods.setFloat16 = function (this: DataView, ...args: unknown[]) {
  const rounded = f16round(args[1] as number);
  const sign = rounded < 0 || Object.is(rounded, -0) ? 0x8000 : 0;
  const magnitude = Math.abs(rounded);
  let bits: number;
  if (Number.isNaN(magnitude)) bits = 0x7e00;
  else if (magnitude === Infinity) bits = 0x7c00;
  else if (magnitude < 2 ** -14) bits = magnitude * 2 ** 24;
  else {
    const exponent = Math.floor(Math.log2(magnitude));
    bits = ((exponent + 15) << 10) | ((magnitude / 2 ** exponent - 1) * 1024);
  }
  return Reflect.apply(writeUint16, this, [args[0], sign | bits, args[2]]);
};

export function createDataViewGlobal(budget: Budget): SandboxClosure {
  const prototype: SandboxObject = createIntrinsicObject();
  const constructor = createSandboxClosure({
    guest: true, sandbox: true, name: "DataView", length: 1,
    call: () => { throw new TypeError("DataView requires new."); },
    construct: async (args, context) => {
      const buffer = args[0];
      if (!isSandboxArrayBuffer(buffer) && !isSandboxSharedArrayBuffer(buffer)) throw new TypeError("DataView requires supported backing storage.");
      let selected: SandboxValue;
      const release = retainValues(budget, () => [...args, selected]);
      try {
        const offset = await dataViewIndex(args[1], budget, context);
        if (arrayBufferDetached(buffer)) throw new TypeError("Cannot view a detached buffer.");
        const length = arrayBufferLength(buffer);
        if (offset > length) throw new RangeError("DataView offset exceeds buffer length.");
        const size = args[2] === undefined ? undefined : await dataViewIndex(args[2], budget, context);
        if (size !== undefined && offset + size > length) throw new RangeError("DataView length exceeds buffer length.");
        const target = context?.newTarget ?? constructor;
        if (context?.getProperty !== undefined) selected = await context.getProperty(target, "prototype");
        else {
          const descriptor = getSandboxPropertyDescriptor(target, "prototype", budget);
          selected = descriptor === undefined ? undefined : await readPropertyDescriptor(descriptor, target, context);
        }
        if (selected === null || typeof selected !== "object")
          selected = getFunctionRealmPrototype(target, "DataView", prototype);
        budget.provisionDataUsage(1)();
        const value = new DataView(buffer, offset, size);
        if (arrayBufferOptions(buffer) !== undefined) dataViewLayouts.set(value, { byteOffset: offset, ...(size === undefined ? {} : { byteLength: size }) });
        setSandboxPrototype(value, selected, budget);
        return value;
      } finally { release(); }
    }
  });
  Object.defineProperty(materializeFunctionProperties(constructor), "prototype", { value: prototype });
  Object.defineProperties(prototype, {
    constructor: { value: constructor, writable: true, configurable: true },
    [Symbol.toStringTag]: { value: "DataView", configurable: true }
  });
  const getters: SandboxClosure[] = [];
  for (const [name, getter] of Object.entries(dataViewGetters)) {
    const closure = createSandboxClosure({ guest: true, sandbox: true, name: `get ${name}`, length: 0,
      call: (_args, context) => {
        if (!isSandboxDataView(context?.thisValue)) throw new TypeError("DataView getter requires a DataView receiver.");
        return Reflect.apply(getter, context.thisValue, []) as SandboxValue;
      } });
    Object.defineProperty(prototype, name, { get: accessorAdapter(closure, "get"), configurable: true });
    getters.push(closure);
  }
  for (const [name, method] of Object.entries(methods)) {
    const setter = name.startsWith("set");
    Object.defineProperty(prototype, name, { writable: true, configurable: true,
      value: createSandboxClosure({ guest: true, sandbox: true, name, length: setter ? 2 : 1,
        call: async (args, context) => {
          const receiver = context?.thisValue;
          if (!isSandboxDataView(receiver)) throw new TypeError("DataView method requires a DataView receiver.");
          const release = retainValues(budget, () => [receiver, ...args]);
          try {
            const offset = await dataViewIndex(args[0], budget, context);
            const value = setter ? name.startsWith("setBig") ? await sandboxBigInt(args[1], budget, context)
              : await sandboxNumber(args[1], budget, context) : undefined;
            return Reflect.apply(method, receiver, setter ? [offset, value, Boolean(args[2])] : [offset, Boolean(args[1])]) as SandboxValue;
          } finally { release(); }
        } }) });
  }
  setSandboxPrototype(prototype, getSandboxPrototype(Object.create(null), budget));
  dataViewPrototypes.set(budget, prototype);
  registerBuiltinIdentities(budget, { DataView: constructor });
  registerIntrinsicFunction(budget, constructor);
  for (const getter of getters) registerIntrinsicFunction(budget, getter);
  registerIntrinsicObject(budget, prototype);
  return constructor;
}

async function dataViewIndex(value: SandboxValue, budget: Budget, context?: SandboxCallContext): Promise<number> {
  const number = await sandboxNumber(value, budget, context);
  const index = Number.isNaN(number) ? 0 : Math.trunc(number);
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Invalid DataView index.");
  return index;
}
