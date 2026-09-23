import { commandLimits } from "../safejs/options.js";
import type { SafeJsModule } from "../safejs/types.js";
import type { NodeSafeJsCommandOptions } from "./types.js";

// The byte storage and methods belong to the guest. Only bounded encoding
// conversions cross the existing copying host bridge; no native Buffer escapes.
export const bufferSource = `
class Buffer extends Uint8Array {
  static from(value, encodingOrOffset, length) {
    if (typeof value === "string") return new Buffer(__safeBashBuffer.encode(value, encodingOrOffset));
    if (value instanceof ArrayBuffer) return new Buffer(value, encodingOrOffset, length);
    if (Array.isArray(value) || value instanceof Uint8Array) return new Buffer(value);
    if (value && value.type === "Buffer" && Array.isArray(value.data)) return new Buffer(value.data);
    throw new TypeError("Buffer.from requires a string, byte array or ArrayBuffer");
  }
  static alloc(size, fill = 0, encoding) {
    if (typeof size !== "number") throw new TypeError("Buffer size must be a number");
    if (!Number.isFinite(size) || size < 0) throw new RangeError("Invalid Buffer size");
    const result = new Buffer(size);
    if (fill === "") return result;
    if (typeof fill === "string" || fill instanceof Uint8Array) {
      const pattern = Buffer.from(fill, encoding);
      if (pattern.length === 0 && size > 0) throw new TypeError("Invalid Buffer fill");
      for (let i = 0; i < result.length; i++) result[i] = pattern[i % pattern.length];
    } else result.fill(fill);
    return result;
  }
  static isBuffer(value) { return value instanceof Buffer; }
  static isEncoding = __safeBashBuffer.isEncoding;
  static byteLength(value, encoding) {
    if (typeof value === "string") return __safeBashBuffer.byteLength(value, encoding);
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
    throw new TypeError("Buffer.byteLength requires a string, ArrayBuffer or view");
  }
  static concat(list, totalLength) {
    if (!Array.isArray(list) || !list.every(value => value instanceof Uint8Array)) throw new TypeError("Buffer.concat requires byte arrays");
    if (totalLength === undefined) totalLength = list.reduce((size, value) => size + value.length, 0);
    if (typeof totalLength !== "number") throw new TypeError("Buffer length must be a number");
    if (!Number.isInteger(totalLength) || totalLength < 0) throw new RangeError("Invalid Buffer length");
    const result = Buffer.alloc(totalLength);
    let offset = 0;
    for (const value of list) {
      const count = Math.min(value.length, result.length - offset);
      if (count <= 0) break;
      result.set(value.subarray(0, count), offset);
      offset += count;
    }
    return result;
  }
  toString(encoding, start = 0, end = this.length) {
    start = Math.min(this.length, Math.max(0, Math.trunc(start) || 0));
    end = Math.min(this.length, Math.max(0, Math.trunc(end) || 0));
    return __safeBashBuffer.decode(Array.from(super.subarray(start, Math.max(start, end))), encoding);
  }
  subarray(start, end) {
    const view = super.subarray(start, end);
    return new Buffer(view.buffer, view.byteOffset, view.byteLength);
  }
  equals(other) {
    if (!(other instanceof Uint8Array)) throw new TypeError("Buffer.equals requires a byte array");
    return this.length === other.length && this.every((value, index) => value === other[index]);
  }
  toJSON() { return { type: "Buffer", data: Array.from(this) }; }
}
Buffer.prototype.slice = Buffer.prototype.subarray;
`;

export function bufferBindings<Budget>(options: NodeSafeJsCommandOptions<Budget>): SafeJsModule {
  const limits = commandLimits(options.limits);
  const declare = options.runtime.declareHostOperation;
  const exceeded = (resource: "arrayLength" | "stringLength"): never => {
    throw Object.assign(new RangeError(`Buffer ${resource} limit exceeded`), { code: "budgetExceeded" });
  };
  const encoding = (value: unknown): BufferEncoding => {
    if (value === undefined || value === "") return "utf8";
    if (typeof value !== "string" || !Buffer.isEncoding(value)) throw new TypeError("Unknown Buffer encoding");
    return value as BufferEncoding;
  };
  return {
    encode: declare((value: unknown, selected: unknown) => {
      if (typeof value !== "string") throw new TypeError("Buffer input must be a string");
      const codec = encoding(selected);
      if (Buffer.byteLength(value, codec) > limits.arrayLength) exceeded("arrayLength");
      return Array.from(Buffer.from(value, codec));
    }, "read-side-effect"),
    decode: declare((value: unknown, selected: unknown) => {
      if (!Array.isArray(value)) throw new TypeError("Buffer bytes must be an array");
      if (value.length > limits.arrayLength) exceeded("arrayLength");
      if (!value.every(byte => typeof byte === "number" && Number.isInteger(byte) && byte >= 0 && byte <= 255)) throw new TypeError("Invalid Buffer byte");
      const result = Buffer.from(value).toString(encoding(selected));
      if (result.length > limits.stringLength) exceeded("stringLength");
      return result;
    }, "read-side-effect"),
    isEncoding: declare((value: unknown) => typeof value === "string" && Buffer.isEncoding(value), "read-side-effect"),
    byteLength: declare((value: unknown, selected: unknown) => {
      if (typeof value !== "string") throw new TypeError("Buffer input must be a string");
      return Buffer.byteLength(value, typeof selected === "string" && Buffer.isEncoding(selected) ? selected : "utf8");
    }, "read-side-effect"),
  };
}
