import { InputTypeError } from "./archive.js";

/** A native view of attached, unshared bytes; no caller getters or byte allocation. */
export function documentByteView(bytes: Uint8Array): Uint8Array {
  try {
    if (!(bytes instanceof Uint8Array)) throw new TypeError();
    const prototype = Object.getPrototypeOf(Uint8Array.prototype);
    const buffer = Object.getOwnPropertyDescriptor(prototype, "buffer")!.get!.call(
      bytes
    ) as ArrayBufferLike;
    if (!(buffer instanceof ArrayBuffer)) throw new TypeError();
    const offset = Object.getOwnPropertyDescriptor(prototype, "byteOffset")!.get!.call(
      bytes
    ) as number;
    const length = Object.getOwnPropertyDescriptor(prototype, "byteLength")!.get!.call(
      bytes
    ) as number;
    // Constructing even a zero-length view rejects a detached backing buffer.
    return new Uint8Array(buffer, offset, length);
  } catch {
    throw new InputTypeError("Expected attached, unshared byte input.");
  }
}
