import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";
import { normalizeSlice } from "./integer-sequence.js";
import { searchSubstring, substringMatches, type SearchMode } from "./substring-search.js";
import { isAsciiWhitespace } from "./ascii-whitespace.js";
import type { CodePointString } from "./code-point-string.js";
import { renderIntegerPercentBuffer, type IntegerPercentField } from "./integer-percent-field.js";
import { renderFloatPercentBuffer, type FloatPercentField } from "./float-percent-field.js";

export type BytesCaseTransformation = "upper" | "lower" | "title" | "capitalize" | "swapcase";

/** Internal immutable bytes payload, not a guest object or releasable memoryview.
 * Public input/output buffers are copied. Internally created slices transfer sole
 * buffer ownership without a second copy. Buffer allocation and operations are
 * metered; host object/iterator overhead accounting remains unfinished. The host
 * iterator exposes only byte numbers; guest iterator adapters must meter next().
 */
export class ImmutableBytes implements Iterable<number> {
  readonly #bytes: Uint8Array;
  readonly length: number;

  private constructor(owned: Uint8Array) {
    this.#bytes = owned;
    this.length = owned.length;
    Object.freeze(this);
  }

  static copyOf(input: Uint8Array | readonly number[], meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint(1, input.length);
    const owned = new Uint8Array(input.length);
    for (let index = 0; index < input.length; index++) {
      meter.checkpoint(); const byte = input[index];
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new RangeError("byte value must be an integer in range 0..255");
      owned[index] = byte;
    }
    return new ImmutableBytes(owned);
  }

  /** Copy trusted ASCII text directly into one owned byte buffer. This is not
   * the guest encode protocol: non-ASCII input is a caller invariant failure. */
  static fromAscii(source: CodePointString, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint(1, source.length);
    const bytes = new Uint8Array(source.length);
    let index = 0;
    for (const point of source) {
      meter.checkpoint();
      if (point > 127) throw new RangeError("expected ASCII code points");
      bytes[index++] = point;
    }
    return new ImmutableBytes(bytes);
  }

  /** Adopt the shared integer renderer's fresh byte buffer without an intermediate
   * code-point buffer or second copy. Numeric output is entirely ASCII bytes. */
  static fromIntegerPercentField(value: bigint, field: IntegerPercentField, meter: ExecutionMeter, maxDecimalDigits?: number): ImmutableBytes {
    const bytes = renderIntegerPercentBuffer(value, field, Uint8Array, meter, maxDecimalDigits);
    return new ImmutableBytes(bytes);
  }

  /** Adopt the floating renderer's byte buffer with no code-point intermediate. */
  static fromFloatPercentField(value: number, field: FloatPercentField, meter: ExecutionMeter): ImmutableBytes {
    const bytes = renderFloatPercentBuffer(value, field, Uint8Array, meter);
    return new ImmutableBytes(bytes);
  }

  /** Build the identity mapping first, then apply ordered overrides. */
  static maketrans(from: ImmutableBytes, to: ImmutableBytes, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (from.length !== to.length) throw new PythonRuntimeError("ValueError", "maketrans arguments must have same length");
    meter.checkpoint(0, 256);
    const bytes = new Uint8Array(256);
    for (let byte = 0; byte < 256; byte++) { meter.checkpoint(); bytes[byte] = byte; }
    for (let index = 0; index < from.length; index++) { meter.checkpoint(); bytes[from.#bytes[index]] = to.#bytes[index]; }
    return new ImmutableBytes(bytes);
  }

  /** Text rejects its first non-ASCII point before hex parsing. Byte inputs
   * parse directly. Validate/count before allocating one exact output buffer. */
  static fromHex(source: ImmutableBytes | CodePointString, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (!(source instanceof ImmutableBytes)) {
      let position = 0;
      for (const point of source) {
        meter.checkpoint();
        if (point > 127) throw new PythonRuntimeError("ValueError", `non-hexadecimal number found in fromhex() arg at position ${position}`);
        position++;
      }
    }
    let length = 0;
    for (const ignoredByte of decodedHexBytes(source, meter)) length++;
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const byte of decodedHexBytes(source, meter)) bytes[offset++] = byte;
    return new ImmutableBytes(bytes);
  }

  /** Encode magnitude digits once, then carry two's complement from the low
   * byte. Host BigInt string size is charged after conversion until integer
   * payload size metadata is available, as with integer bit metrics. */
  static fromInteger(value: bigint, length: bigint, little: boolean, signed: boolean, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (length < 0n) throw new PythonRuntimeError("ValueError", "length argument must be non-negative");
    if (length > 0xffffffffn) exhaustAllocation(meter);
    const negative = value < 0n;
    if (negative && !signed) throw new PythonRuntimeError("OverflowError", "can't convert negative int to unsigned");
    const digits = value.toString(16), start = negative ? 1 : 0;
    meter.checkpoint(1, 32 + digits.length * 2);
    const firstCode = digits.charCodeAt(start), first = firstCode >= 97 ? firstCode - 87 : firstCode - 48;
    const bits = value === 0n ? 0 : (digits.length - start - 1) * 4 + 32 - Math.clz32(first), capacity = Number(length) * 8;
    let fits = bits <= capacity;
    if (signed && value !== 0n) {
      if (!negative) fits = bits < capacity;
      else if (bits === capacity) {
        fits = (first & (first - 1)) === 0;
        for (let index = start + 1; fits && index < digits.length; index++) { meter.checkpoint(); fits = digits.charCodeAt(index) === 48; }
      }
    }
    if (!fits) throw new PythonRuntimeError("OverflowError", "int too big to convert");
    meter.checkpoint(0, Number(length));
    const bytes = new Uint8Array(Number(length));
    let position = digits.length - 1, carry = negative ? 1 : 0;
    for (let offset = 0; offset < bytes.length; offset++) {
      meter.checkpoint();
      let byte = 0;
      for (let shift = 0; shift < 8 && position >= start; shift += 4) {
        const code = digits.charCodeAt(position--), digit = code >= 97 ? code - 87 : code - 48;
        byte |= digit << shift;
      }
      if (negative) { byte = 255 - byte + carry; carry = byte >>> 8; byte &= 255; }
      bytes[little ? offset : bytes.length - offset - 1] = byte;
    }
    return new ImmutableBytes(bytes);
  }

  *[Symbol.iterator](): IterableIterator<number> {
    for (let index = 0; index < this.length; index++) yield this.#bytes[index];
  }

  toUint8Array(meter: ExecutionMeter): Uint8Array {
    meter.checkpoint(1, this.length);
    const output = new Uint8Array(this.length);
    for (let index = 0; index < this.length; index++) { meter.checkpoint(); output[index] = this.#bytes[index]; }
    return output;
  }

  byteAt(index: bigint, meter: ExecutionMeter): number {
    meter.checkpoint();
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
    if (index < 0n) index += BigInt(this.length);
    if (index < 0n || index >= BigInt(this.length)) throw new PythonRuntimeError("IndexError", "index out of range");
    return this.#bytes[Number(index)];
  }

  slice(start: bigint | null, stop: bigint | null, step: bigint | null, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    const indices = normalizeSlice(BigInt(this.length), start, stop, step);
    const count = Number(indices.length);
    meter.checkpoint(0, count);
    const owned = new Uint8Array(count);
    const stride = count > 1 ? Number(indices.step) : 0;
    for (let offset = 0, index = Number(indices.start); offset < count; offset++, index += stride) {
      meter.checkpoint(); owned[offset] = this.#bytes[index];
    }
    return new ImmutableBytes(owned);
  }

  repeat(count: number, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("repeat requires a nonnegative safe integer");
    if (this.length === 0 || count === 1) return this;
    const length = this.length * count;
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) { meter.checkpoint(); bytes[i] = this.#bytes[i % this.length]; }
    return new ImmutableBytes(bytes);
  }

  /** Bytes casing is ASCII-only and never expands its input. Non-ASCII bytes
   * are preserved and break title words, regardless of the host locale. */
  transformCase(mode: BytesCaseTransformation, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (this.length === 0) return this;
    meter.checkpoint(0, this.length);
    const bytes = new Uint8Array(this.length);
    let previousCased = false;
    for (let index = 0; index < this.length; index++) {
      meter.checkpoint();
      const byte = this.#bytes[index], upper = byte >= 65 && byte <= 90, lower = byte >= 97 && byte <= 122;
      const toUpper = mode === "upper" || mode === "swapcase" && lower || mode === "title" && !previousCased || mode === "capitalize" && index === 0;
      const toLower = mode === "lower" || mode === "swapcase" && upper || mode === "title" && previousCased || mode === "capitalize" && index !== 0;
      bytes[index] = toUpper && lower ? byte - 32 : toLower && upper ? byte + 32 : byte;
      previousCased = upper || lower;
    }
    return new ImmutableBytes(bytes);
  }

  /** Size first, then fill a single owned buffer. Only CR/LF reset columns. */
  expandTabs(tabsize: number, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (!Number.isSafeInteger(tabsize)) throw new RangeError("tab size must be a safe integer");
    if (this.length === 0) return this;
    let length = 0, column = 0;
    for (const byte of this.#bytes) {
      meter.checkpoint();
      if (byte === 9) {
        const spaces = tabsize > 0 ? tabsize - column % tabsize : 0;
        length += spaces; column += spaces;
      } else { length++; column = byte === 10 || byte === 13 ? 0 : column + 1; }
      if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    }
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    let offset = 0;
    column = 0;
    for (const byte of this.#bytes) {
      meter.checkpoint();
      if (byte === 9) {
        const spaces = tabsize > 0 ? tabsize - column % tabsize : 0, end = offset + spaces;
        while (offset < end) { meter.checkpoint(); bytes[offset++] = 32; }
        column += spaces;
      } else { bytes[offset++] = byte; column = byte === 10 || byte === 13 ? 0 : column + 1; }
    }
    return new ImmutableBytes(bytes);
  }

  /** Render converted nonnumeric percent fields with byte-count precision.
   * Truncation and space padding share one preflighted owned result buffer. */
  formatField(width: bigint, precision: bigint | null, left: boolean, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (width < 0n || (precision !== null && precision < 0n)) throw new RangeError("field dimensions must be nonnegative");
    const count = precision === null || precision >= BigInt(this.length) ? this.length : Number(precision);
    if (width <= BigInt(count) && count === this.length) return this;
    if (width > 0xffffffffn) exhaustAllocation(meter);
    const length = Math.max(count, Number(width));
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length), start = left ? 0 : length - count;
    let offset = 0;
    while (offset < start) { meter.checkpoint(); bytes[offset++] = 32; }
    for (let index = 0; index < count; index++) { meter.checkpoint(); bytes[offset++] = this.#bytes[index]; }
    while (offset < length) { meter.checkpoint(); bytes[offset++] = 32; }
    return new ImmutableBytes(bytes);
  }

  /** Padding owns one final buffer; sign alignment recognizes only ASCII +/- . */
  pad(width: bigint, alignment: "left" | "right" | "center" | "sign", fill: number, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (!Number.isInteger(fill) || fill < 0 || fill > 255) throw new RangeError("padding requires a valid byte");
    if (width <= BigInt(this.length)) return this;
    if (width > 0xffffffffn) exhaustAllocation(meter);
    const length = Number(width), padding = length - this.length;
    const left = alignment === "left" ? 0 : alignment === "center"
      ? Math.floor(padding / 2) + (padding % 2) * (length % 2) : padding;
    const sign = alignment === "sign" && (this.#bytes[0] === 43 || this.#bytes[0] === 45) ? 1 : 0;
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    let offset = 0;
    if (sign) { meter.checkpoint(); bytes[offset++] = this.#bytes[0]; }
    for (let index = 0; index < left; index++) { meter.checkpoint(); bytes[offset++] = fill; }
    for (let index = sign; index < this.length; index++) { meter.checkpoint(); bytes[offset++] = this.#bytes[index]; }
    while (offset < length) { meter.checkpoint(); bytes[offset++] = fill; }
    return new ImmutableBytes(bytes);
  }

  /** Two linear scans count and copy nonoverlapping matches without retaining
   * match positions. Empty patterns insert at at most length + 1 boundaries. */
  replace(old: ImmutableBytes, replacement: ImmutableBytes, count: bigint, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (count === 0n || old.length > this.length || (old.length === 0 && replacement.length === 0)) return this;
    const limit = count < 0n || count > BigInt(this.length) + 1n ? this.length + 1 : Number(count);
    let matches = 0;
    if (old.length === 0) matches = Math.min(limit, this.length + 1);
    else for (const ignoredIndex of substringMatches(this.#bytes, old.#bytes, false, meter)) {
      if (++matches === limit) break;
    }
    if (matches === 0) return this;
    const length = this.length + matches * (replacement.length - old.length);
    if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    let offset = 0, source = 0;
    if (old.length === 0) {
      for (let boundary = 0; boundary <= this.length; boundary++) {
        meter.checkpoint();
        if (boundary < matches) for (const byte of replacement.#bytes) { meter.checkpoint(); bytes[offset++] = byte; }
        if (boundary < this.length) { meter.checkpoint(); bytes[offset++] = this.#bytes[boundary]; }
      }
    } else {
      let remaining = matches;
      for (const index of substringMatches(this.#bytes, old.#bytes, false, meter)) {
        while (source < index) { meter.checkpoint(); bytes[offset++] = this.#bytes[source++]; }
        for (const byte of replacement.#bytes) { meter.checkpoint(); bytes[offset++] = byte; }
        source = index + old.length;
        if (--remaining === 0) break;
      }
      while (source < this.length) { meter.checkpoint(); bytes[offset++] = this.#bytes[source++]; }
    }
    return new ImmutableBytes(bytes);
  }

  /** Emit pieces in scan order; the runtime reverses right-to-left results.
   * A zero-limit whitespace remainder is copied even when it spans the input. */
  *split(separator: ImmutableBytes | null, maxsplit: bigint, reverse: boolean, meter: ExecutionMeter): IterableIterator<ImmutableBytes> {
    meter.checkpoint(1, 64);
    let remaining = maxsplit < 0n ? BigInt(this.length) + 1n : maxsplit;
    if (separator !== null) {
      if (separator.length === 0) throw new PythonRuntimeError("ValueError", "empty separator");
      let boundary = reverse ? this.length : 0;
      if (remaining !== 0n) for (const index of substringMatches(this.#bytes, separator.#bytes, reverse, meter)) {
        yield this.slice(BigInt(reverse ? index + separator.length : boundary), BigInt(reverse ? boundary : index), null, meter);
        boundary = reverse ? index : index + separator.length;
        if (--remaining === 0n) break;
      }
      const start = reverse ? 0 : boundary, stop = reverse ? boundary : this.length;
      yield start === 0 && stop === this.length ? this : this.slice(BigInt(start), BigInt(stop), null, meter);
      return;
    }
    const step = reverse ? -1 : 1;
    let index = reverse ? this.length - 1 : 0;
    while (index >= 0 && index < this.length) {
      while (index >= 0 && index < this.length) {
        meter.checkpoint();
        if (!isAsciiWhitespace(this.#bytes[index])) break;
        index += step;
      }
      if (index < 0 || index >= this.length) return;
      const start = index;
      if (remaining === 0n) {
        yield this.slice(BigInt(reverse ? 0 : start), BigInt(reverse ? start + 1 : this.length), null, meter);
        return;
      }
      while (index >= 0 && index < this.length) {
        meter.checkpoint();
        if (isAsciiWhitespace(this.#bytes[index])) break;
        index += step;
      }
      const begin = reverse ? index + 1 : start, stop = reverse ? start + 1 : index;
      yield begin === 0 && stop === this.length ? this : this.slice(BigInt(begin), BigInt(stop), null, meter);
      remaining--;
    }
  }

  /** Delete original bytes before mapping, sizing only retained bytes. A fixed
   * membership table avoids storage proportional to a repeated deletion set. */
  translate(table: ImmutableBytes | null, deleted: ImmutableBytes | null, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (table !== null && table.length !== 256) throw new PythonRuntimeError("ValueError", "translation table must be 256 characters long");
    if (this.length === 0 || table === null && (deleted === null || deleted.length === 0)) return this;
    let members: Uint8Array | undefined;
    if (deleted !== null && deleted.length > 0) {
      meter.checkpoint(0, 256); members = new Uint8Array(256);
      for (const byte of deleted.#bytes) { meter.checkpoint(); members[byte] = 1; }
    }
    let length = 0, changed = false;
    for (const byte of this.#bytes) {
      meter.checkpoint();
      if (members?.[byte] === 1) { changed = true; continue; }
      length++;
      if (table !== null && table.#bytes[byte] !== byte) changed = true;
    }
    if (!changed) return this;
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const byte of this.#bytes) {
      meter.checkpoint();
      if (members?.[byte] !== 1) bytes[offset++] = table === null ? byte : table.#bytes[byte];
    }
    return new ImmutableBytes(bytes);
  }

  /** Skip sign extension, form hexadecimal magnitude once, and use one host
   * BigInt parse instead of repeated shifts of an ever-growing integer. For
   * negatives, complemented bytes encode -value-1 without a giant power of two. */
  toInteger(little: boolean, signed: boolean, meter: ExecutionMeter): bigint {
    meter.checkpoint();
    if (this.length === 0) return 0n;
    const step = little ? -1 : 1;
    let index = little ? this.length - 1 : 0;
    const negative = signed && this.#bytes[index] >= 128, fill = negative ? 255 : 0;
    while (index >= 0 && index < this.length) {
      meter.checkpoint();
      if (this.#bytes[index] !== fill) break;
      index += step;
    }
    if (index < 0 || index >= this.length) return negative ? -1n : 0n;
    const remaining = little ? index + 1 : this.length - index;
    // Reserve bounded-per-byte text construction and bigint payloads before
    // conversion. Full host BigInt object-overhead accounting remains pending.
    meter.checkpoint(0, 32 + remaining * 75);
    const alphabet = "0123456789abcdef";
    let hex = "0x";
    for (; index >= 0 && index < this.length; index += step) {
      meter.checkpoint();
      const byte = this.#bytes[index] ^ fill;
      hex += alphabet[byte >>> 4] + alphabet[byte & 15];
    }
    try {
      const magnitude = BigInt(hex);
      return negative ? -magnitude - 1n : magnitude;
    } catch (error) {
      if (error instanceof RangeError) exhaustAllocation(meter);
      throw error;
    }
  }

  concat(other: ImmutableBytes, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (this.length === 0) return other;
    if (other.length === 0) return this;
    meter.checkpoint(0, this.length + other.length);
    const bytes = new Uint8Array(this.length + other.length);
    for (let i = 0; i < this.length; i++) { meter.checkpoint(); bytes[i] = this.#bytes[i]; }
    for (let i = 0; i < other.length; i++) { meter.checkpoint(); bytes[this.length + i] = other.#bytes[i]; }
    return new ImmutableBytes(bytes);
  }

  /** Index custom byte sets once, scan only the edges, and copy one final slice. */
  strip(side: "strip" | "lstrip" | "rstrip", chars: ImmutableBytes | null, meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (this.length === 0 || chars?.length === 0) return this;
    let members: Uint8Array | undefined;
    if (chars !== null) {
      meter.checkpoint(1, 256); members = new Uint8Array(256);
      for (const byte of chars.#bytes) { meter.checkpoint(); members[byte] = 1; }
    }
    let start = 0, stop = this.length;
    if (side !== "rstrip") while (start < stop) {
      meter.checkpoint(); const byte = this.#bytes[start];
      if (members === undefined ? !isAsciiWhitespace(byte) : members[byte] === 0) break;
      start++;
    }
    if (side !== "lstrip") while (stop > start) {
      meter.checkpoint(); const byte = this.#bytes[stop - 1];
      if (members === undefined ? !isAsciiWhitespace(byte) : members[byte] === 0) break;
      stop--;
    }
    if (start === 0 && stop === this.length) return this;
    return this.slice(BigInt(start), BigInt(stop), null, meter);
  }

  /** Size all validated parts before allocating a single owned output buffer. */
  join(parts: readonly ImmutableBytes[], meter: ExecutionMeter): ImmutableBytes {
    meter.checkpoint();
    if (parts.length === 1) return parts[0];
    let length = 0;
    for (let index = 0; index < parts.length; index++) {
      meter.checkpoint();
      length += parts[index].length + (index === 0 ? 0 : this.length);
      if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    }
    meter.checkpoint(0, length);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (let index = 0; index < parts.length; index++) {
      meter.checkpoint();
      if (index !== 0) for (const byte of this.#bytes) { meter.checkpoint(); bytes[offset++] = byte; }
      for (const byte of parts[index].#bytes) { meter.checkpoint(); bytes[offset++] = byte; }
    }
    return new ImmutableBytes(bytes);
  }

  /** Bounded searches retain original byte positions, including empty-pattern
   * boundaries. Integer needles use an allocation-free scan. */
  search(needle: ImmutableBytes | number, mode: SearchMode, start = 0n, stop: bigint | null = null, meter: ExecutionMeter): number {
    meter.checkpoint();
    if (typeof needle === "number" && (!Number.isInteger(needle) || needle < 0 || needle > 255)) throw new RangeError("byte search requires an integer in range 0..255");
    const length = BigInt(this.length), needleLength = typeof needle === "number" ? 1 : needle.length;
    if (start < 0n) start += length;
    if (start < 0n) start = 0n;
    stop ??= length;
    if (stop < 0n) stop += length;
    if (stop < 0n) stop = 0n;
    if (stop > length) stop = length;
    if (start > stop || BigInt(needleLength) > stop - start) return mode === "count" ? 0 : -1;
    if (needleLength === 0) return Number(mode === "find" ? start : mode === "rfind" ? stop : stop - start + 1n);
    if (typeof needle !== "number") return searchSubstring(this.#bytes, needle.#bytes, Number(start), Number(stop), mode, meter);
    let result = mode === "count" ? 0 : -1;
    for (let index = Number(start); index < Number(stop); index++) {
      meter.checkpoint();
      if (this.#bytes[index] !== needle) continue;
      if (mode === "find") return index;
      if (mode === "count") result++; else result = index;
    }
    return result;
  }

  /** Compare one normalized edge in place, never exporting or slicing storage. */
  hasAffix(affix: ImmutableBytes, side: "start" | "end", start = 0n, stop: bigint | null = null, meter: ExecutionMeter): boolean {
    meter.checkpoint();
    const length = BigInt(this.length);
    if (start < 0n) start += length;
    if (start < 0n) start = 0n;
    stop ??= length;
    if (stop < 0n) stop += length;
    if (stop < 0n) stop = 0n;
    if (stop > length) stop = length;
    if (start > stop || BigInt(affix.length) > stop - start) return false;
    if (affix.length === 0) return true;
    const offset = side === "start" ? Number(start) : Number(stop) - affix.length;
    meter.checkpoint();
    if (this.#bytes[offset] !== affix.#bytes[0] || this.#bytes[offset + affix.length - 1] !== affix.#bytes[affix.length - 1]) return false;
    for (let index = 1; index < affix.length - 1; index++) {
      meter.checkpoint();
      if (this.#bytes[offset + index] !== affix.#bytes[index]) return false;
    }
    return true;
  }

  /** Search owned storage without exporting/copying either buffer. */
  contains(needle: ImmutableBytes | number, meter: ExecutionMeter): boolean {
    meter.checkpoint();
    if (typeof needle === "number") {
      if (!Number.isInteger(needle) || needle < 0 || needle > 255) throw new RangeError("byte search requires an integer in range 0..255");
      for (let index = 0; index < this.length; index++) { meter.checkpoint(); if (this.#bytes[index] === needle) return true; }
      return false;
    }
    if (needle.length === 0) return true;
    if (needle.length > this.length) return false;
    return searchSubstring(this.#bytes, needle.#bytes, 0, this.length, "find", meter) !== -1;
  }

  compare(other: ImmutableBytes, meter: ExecutionMeter): -1 | 0 | 1 {
    meter.checkpoint();
    const common = Math.min(this.length, other.length);
    for (let index = 0; index < common; index++) {
      meter.checkpoint();
      if (this.#bytes[index] !== other.#bytes[index]) return this.#bytes[index] < other.#bytes[index] ? -1 : 1;
    }
    return this.length === other.length ? 0 : this.length < other.length ? -1 : 1;
  }
}

function* decodedHexBytes(source: ImmutableBytes | CodePointString, meter: ExecutionMeter): IterableIterator<number> {
  meter.checkpoint(1, 64);
  let high: number | null = null, position = 0;
  for (const point of source) {
    meter.checkpoint();
    if (high === null && isAsciiWhitespace(point)) { position++; continue; }
    const digit = point >= 48 && point <= 57 ? point - 48 : point >= 65 && point <= 70 ? point - 55 : point >= 97 && point <= 102 ? point - 87 : -1;
    if (digit < 0) throw new PythonRuntimeError("ValueError", `non-hexadecimal number found in fromhex() arg at position ${position}`);
    if (high === null) high = digit;
    else { yield high * 16 + digit; high = null; }
    position++;
  }
  if (high !== null) throw new PythonRuntimeError("ValueError", "fromhex() arg must contain an even number of hexadecimal digits");
}
