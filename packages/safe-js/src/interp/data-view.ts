import { types } from "node:util";
import type { Budget } from "./budget.js";
import type { SandboxObject } from "./values.js";
import { arrayBufferDetached, arrayBufferLength, arrayBufferOptions, copyArrayBufferStorage, isSandboxArrayBuffer } from "./array-buffer.js";
import { isSandboxSharedArrayBuffer } from "./shared-array-buffer.js";

export const dataViewPrototypes = new WeakMap<Budget, SandboxObject>();
export const dataViewLayouts = new WeakMap<DataView, { byteOffset: number; byteLength?: number }>();
export const dataViewGetters = Object.fromEntries(["buffer", "byteOffset", "byteLength"].map(key =>
  [key, Object.getOwnPropertyDescriptor(DataView.prototype, key)!.get!])) as Record<"buffer" | "byteOffset" | "byteLength", (this: DataView) => unknown>;
const resize = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resize")?.value;

export function isSandboxDataView(value: unknown): value is DataView<ArrayBufferLike> {
  return types.isDataView(value) && Object.getPrototypeOf(value) === DataView.prototype;
}

export function dataViewBuffer(value: DataView): ArrayBufferLike {
  const buffer = Reflect.apply(dataViewGetters.buffer, value, []);
  if (!isSandboxArrayBuffer(buffer) && !isSandboxSharedArrayBuffer(buffer)) throw new TypeError("DataView requires supported backing storage.");
  return buffer;
}

export function dataViewLayout(value: DataView): { byteOffset: number; byteLength?: number } {
  const buffer = dataViewBuffer(value);
  if (arrayBufferDetached(buffer)) return { byteOffset: 0, byteLength: 0 };
  if (arrayBufferOptions(buffer) !== undefined) {
    const layout = dataViewLayouts.get(value);
    if (layout === undefined) throw new TypeError("Resizable DataView persistence requires known view layout.");
    return layout;
  }
  return { byteOffset: Reflect.apply(dataViewGetters.byteOffset, value, []) as number,
    byteLength: Reflect.apply(dataViewGetters.byteLength, value, []) as number };
}

export function restoreDataView(buffer: ArrayBufferLike, byteOffset: number, byteLength?: number, budget?: Budget): DataView<ArrayBufferLike> {
  const originalLength = arrayBufferLength(buffer);
  const required = byteOffset + (byteLength ?? 0);
  const options = arrayBufferOptions(buffer);
  const grow = required > originalLength;
  if (grow) {
    if (isSandboxSharedArrayBuffer(buffer) || resize === undefined || options === undefined || required > options.maxByteLength)
      throw new RangeError("DataView layout exceeds backing capacity.");
    budget?.allocateArrayLength(required);
    budget?.provisionDataUsage(required - originalLength)();
    Reflect.apply(resize, buffer, [required]);
  }
  try {
    const view = new DataView(buffer, byteOffset, byteLength);
    if (options !== undefined) dataViewLayouts.set(view, { byteOffset, ...(byteLength === undefined ? {} : { byteLength }) });
    return view;
  } finally { if (grow) Reflect.apply(resize, buffer, [originalLength]); }
}

export function copyDataViewStorage(value: DataView, state: { float32Buffers?: WeakMap<ArrayBufferLike, ArrayBufferLike> }): DataView<ArrayBufferLike> {
  const layout = dataViewLayout(value);
  return restoreDataView(copyArrayBufferStorage(dataViewBuffer(value), state), layout.byteOffset, layout.byteLength);
}

export function dataViewDataProperties(value: DataView): Array<[string | symbol, PropertyDescriptor]> {
  return Reflect.ownKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!("value" in descriptor)) throw new TypeError("DataView accessors cannot be copied as data.");
    return [key, descriptor];
  });
}
