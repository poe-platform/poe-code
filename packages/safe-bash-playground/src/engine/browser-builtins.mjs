import { Buffer as PortableBuffer } from "@jspm/core/nodelibs/buffer";
import { types as browserTypes } from "@jspm/core/nodelibs/util";

export class Buffer extends PortableBuffer {
  static from(...args) {
    return Object.setPrototypeOf(PortableBuffer.from(...args), Buffer.prototype);
  }

  indexOf(value, ...args) {
    return super.indexOf(value instanceof Uint8Array ? PortableBuffer.from(value) : value, ...args);
  }

  lastIndexOf(value, ...args) {
    return super.lastIndexOf(
      value instanceof Uint8Array ? PortableBuffer.from(value) : value,
      ...args
    );
  }

  subarray(...args) {
    return Object.setPrototypeOf(super.subarray(...args), Buffer.prototype);
  }
}

export function isUtf8(bytes) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function isAscii(bytes) {
  return bytes.every((byte) => byte < 128);
}

export const types = Object.freeze({
  ...browserTypes,
  isProxy(value) {
    try {
      structuredClone(value);
      return false;
    } catch {
      return true;
    }
  }
});
