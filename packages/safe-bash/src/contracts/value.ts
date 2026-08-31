declare const byteValueBrand: unique symbol;

export interface ByteShellValue {
  readonly [byteValueBrand]: true;
}

export type ShellValue = string | ByteShellValue;

export interface ValueReservation {
  commit(value: object): void;
  release(): void;
}

export interface ValueAllocation {
  assertOpen(): void;
  reserve(bytes: number, slots: number): ValueReservation;
}

const byteValues = new WeakMap<ByteShellValue, { bytes: Uint8Array; text: string }>();
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const viewBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;
const viewOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const viewLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;

function record(value: ByteShellValue): { bytes: Uint8Array; text: string } {
  const result = byteValues.get(value);
  if (!result) throw new TypeError("Expected an owned shell byte value");
  return result;
}

function allocationSize(length: number, multiplier: number): number {
  const result = length * multiplier + 64;
  if (!Number.isSafeInteger(result)) throw new RangeError("Shell value allocation is too large");
  return result;
}

function allocate<Result extends object>(bytes: number, allocation: ValueAllocation | undefined, create: () => Result, slots = 1): Result {
  allocation?.assertOpen();
  const reservation = allocation?.reserve(bytes, slots);
  try {
    const result = create();
    reservation?.commit(result);
    return result;
  } catch (error) {
    try { reservation?.release(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Shell value allocation and release failed"); }
    throw error;
  }
}

function ownedBytes(bytes: Uint8Array): ByteShellValue {
  const value = Object.freeze({}) as ByteShellValue;
  byteValues.set(value, { bytes, text: decoder.decode(bytes) });
  return value;
}

export function shellValueFromBytes(bytes: Uint8Array, allocation?: ValueAllocation): ByteShellValue {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Shell bytes must be Uint8Array");
  const buffer = viewBuffer.call(bytes) as ArrayBuffer;
  const offset = viewOffset.call(bytes) as number;
  const length = viewLength.call(bytes) as number;
  return allocate(allocationSize(length, 3), allocation, () => {
    if (viewOffset.call(bytes) !== offset || viewLength.call(bytes) < length) throw new TypeError("Shell byte input extent changed during admission");
    return ownedBytes(new Uint8Array(new Uint8Array(buffer, offset, length)));
  });
}

export function shellValueText(value: ShellValue): string {
  return typeof value === "string" ? value : record(value).text;
}

export function shellValueByteLength(value: ShellValue): number {
  return typeof value === "string" ? Buffer.byteLength(value) : record(value).bytes.byteLength;
}

export function shellValueRetainedBytes(value: ByteShellValue): number {
  const stored = record(value);
  return stored.bytes.byteLength + stored.text.length * 2 + 64;
}

export function shellValueBytes(value: ShellValue, allocation?: ValueAllocation): Uint8Array {
  const length = shellValueByteLength(value);
  return allocate(allocationSize(length, 1), allocation, () => typeof value === "string" ? encoder.encode(value) : new Uint8Array(record(value).bytes));
}

export function concatShellValues(values: readonly ShellValue[], allocation?: ValueAllocation): ShellValue {
  allocation?.assertOpen();
  if (!Array.isArray(values)) throw new TypeError("Shell value concatenation requires an array");
  const count = values.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffffff) throw new RangeError("Invalid shell value input extent");
  if (!count) return "";
  if (count === 1) {
    const value = values[0]!;
    if (typeof value !== "string") record(value);
    if (values.length !== count) throw new TypeError("Shell value input extent changed");
    return value;
  }
  let textOnly = true;
  for (let index = 0; index < count; index++) {
    if (typeof values[index] !== "string") { textOnly = false; break; }
  }
  if (textOnly) {
    let text = "";
    for (let index = 0; index < count; index++) {
      const value = values[index];
      if (typeof value !== "string") throw new TypeError("Shell value input type changed during text concatenation");
      text += value;
    }
    if (values.length !== count) throw new TypeError("Shell value input extent changed");
    return text;
  }
  let reservation = allocation?.reserve(allocationSize(count, 16), count + 1);
  const release = (): void => { const pending = reservation; reservation = undefined; pending?.release(); };
  try {
    if (values.length !== count) throw new TypeError("Shell value input extent changed during metadata admission");
    const snapshot: ShellValue[] = new Array(count);
    for (let index = 0; index < count; index++) {
      const value = values[index]!;
      if (typeof value !== "string") record(value);
      snapshot[index] = value;
    }
    if (values.length !== count) throw new TypeError("Shell value input extent changed during snapshot capture");
    Object.freeze(snapshot);
    reservation?.commit(snapshot);
    if (snapshot.every(value => typeof value === "string")) {
      const result = snapshot.join("");
      release();
      return result;
    }
    const length = encodeValues(snapshot);
    return allocate(allocationSize(length, 3), allocation, () => {
      const bytes = new Uint8Array(length);
      encodeValues(snapshot, bytes);
      const result = ownedBytes(bytes);
      release();
      return result;
    });
  } catch (error) {
    try { release(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Shell value snapshot and release failed"); }
    throw error;
  }
}

function encodeValues(values: readonly ShellValue[], output?: Uint8Array): number {
  let offset = 0;
  let high = 0;
  const write = (byte: number): void => { if (output) output[offset] = byte; offset++; };
  const point = (code: number): void => {
    if (code < 0x80) write(code);
    else if (code < 0x800) { write(0xc0 | code >> 6); write(0x80 | code & 0x3f); }
    else if (code < 0x10000) { write(0xe0 | code >> 12); write(0x80 | code >> 6 & 0x3f); write(0x80 | code & 0x3f); }
    else { write(0xf0 | code >> 18); write(0x80 | code >> 12 & 0x3f); write(0x80 | code >> 6 & 0x3f); write(0x80 | code & 0x3f); }
  };
  for (const value of values) {
    if (typeof value !== "string") {
      if (high) { point(0xfffd); high = 0; }
      const bytes = record(value).bytes;
      output?.set(bytes, offset);
      offset += bytes.byteLength;
      continue;
    }
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (high) {
        const previous = high;
        high = 0;
        if (code >= 0xdc00 && code <= 0xdfff) { point(0x10000 + ((previous - 0xd800) << 10) + code - 0xdc00); continue; }
        point(0xfffd);
      }
      if (code >= 0xd800 && code <= 0xdbff) high = code;
      else point(code >= 0xdc00 && code <= 0xdfff ? 0xfffd : code);
    }
  }
  if (high) point(0xfffd);
  if (!Number.isSafeInteger(offset)) throw new RangeError("Shell value allocation is too large");
  return offset;
}
