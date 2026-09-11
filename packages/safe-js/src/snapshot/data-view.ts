import { dataViewLayout, restoreDataView } from "../interp/data-view.js";
import { arrayBufferOptions, isSandboxArrayBuffer } from "../interp/array-buffer.js";
import { isSandboxSharedArrayBuffer } from "../interp/shared-array-buffer.js";
import { getSandboxPrototype, hasExplicitSandboxPrototype } from "../interp/object-model.js";
import { serializePropertyDescriptors } from "./property-descriptors.js";
import { capturePrivateElements, type GuestObjectState } from "./guest-heap.js";
import { privateElements } from "../interp/private-state.js";
import type { Budget } from "../interp/budget.js";

export type DataViewData<T> = { kind: "dataview"; byteOffset: number; byteLength: number; lengthTracking?: true; buffer: T };

export function encodeDataViewLayout(value: DataView): Omit<DataViewData<unknown>, "buffer"> {
  const layout = dataViewLayout(value);
  return { kind: "dataview", byteOffset: layout.byteOffset, byteLength: layout.byteLength ?? 0,
    ...(layout.byteLength === undefined ? { lengthTracking: true } : {}) };
}

export function captureDataViewState<T>(value: DataView, encode: (value: unknown) => T): GuestObjectState<T> {
  return { properties: serializePropertyDescriptors(value, encode),
    ...(privateElements.has(value) ? { privateElements: capturePrivateElements(privateElements.get(value)!, encode) } : {}),
    ...(hasExplicitSandboxPrototype(value) ? { prototype: encode(getSandboxPrototype(value)) } : {}) };
}

export function validateDataViewStorage(value: Record<string, unknown>): void {
  if (!Number.isSafeInteger(value.byteOffset) || Number(value.byteOffset) < 0 ||
      !Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 0 ||
      !Number.isSafeInteger(Number(value.byteOffset) + Number(value.byteLength)))
    throw new TypeError("Invalid DataView dimensions.");
  if (!Object.hasOwn(value, "buffer") || Object.hasOwn(value, "bytes")) throw new TypeError("DataView requires a backing buffer reference.");
  if (Object.hasOwn(value, "lengthTracking") && (value.lengthTracking !== true || value.byteLength !== 0))
    throw new TypeError("Invalid DataView length-tracking layout.");
}

export function decodeDataViewStorage(value: Record<string, unknown>, resolve: (reference: unknown) => unknown, budget?: Budget): DataView<ArrayBufferLike> {
  validateDataViewStorage(value);
  const buffer = resolve(value.buffer);
  if (!isSandboxArrayBuffer(buffer) && !isSandboxSharedArrayBuffer(buffer)) throw new TypeError("Invalid DataView backing reference.");
  if (value.lengthTracking === true && arrayBufferOptions(buffer) === undefined)
    throw new TypeError("Length-tracking DataView requires resizable storage.");
  budget?.provisionDataUsage(1)();
  return restoreDataView(buffer, Number(value.byteOffset), value.lengthTracking === true ? undefined : Number(value.byteLength), budget);
}
