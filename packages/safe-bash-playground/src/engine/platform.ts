const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

class BrowserBytes extends Uint8Array {
  override indexOf(value: number | Uint8Array, offset = 0): number {
    if (typeof value === "number") return super.indexOf(value, offset);
    const start = Math.min(this.length, Math.max(0, offset < 0 ? this.length + offset : offset));
    for (let position = start; position <= this.length - value.length; position++) {
      let matched = true;
      for (let index = 0; index < value.length; index++) {
        if (this[position + index] !== value[index]) {
          matched = false;
          break;
        }
      }
      if (matched) return position;
    }
    return -1;
  }

  override toString(encoding = "utf8", start = 0, end = this.length): string {
    const bytes = this.subarray(start, end);
    if (encoding === "utf8" || encoding === "utf-8") return decoder.decode(bytes);
    if (encoding === "latin1" || encoding === "binary") {
      let result = "";
      for (const byte of bytes) result += String.fromCharCode(byte);
      return result;
    }
    throw new Error(`Unsupported browser byte encoding: ${encoding}`);
  }

  override slice(start?: number, end?: number): BrowserBytes {
    return this.subarray(start, end) as BrowserBytes;
  }
}

export const Buffer = Object.freeze({
  from(
    value: string | ArrayLike<number> | ArrayBuffer,
    offset?: number,
    length?: number
  ): BrowserBytes {
    if (typeof value === "string") return new BrowserBytes(encoder.encode(value));
    if (value instanceof ArrayBuffer) return new BrowserBytes(value, offset, length);
    return new BrowserBytes(value);
  },
  byteLength(value: string | ArrayBufferView | ArrayBuffer): number {
    return typeof value === "string" ? encoder.encode(value).byteLength : value.byteLength;
  },
  compare(left: Uint8Array, right: Uint8Array): number {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
    }
    return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
  }
});

export function setImmediate(callback: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 0);
}

export const clearImmediate = clearTimeout;
export const TransformStream = globalThis.TransformStream;
