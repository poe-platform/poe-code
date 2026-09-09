import { PythonRuntimeError } from "./error.js";
import { normalizeSlice } from "./integer-sequence.js";
import { searchSubstring, substringMatches, type SearchMode } from "./substring-search.js";
import { isUnicodeWhitespace } from "./unicode-whitespace.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { upperMappings, casefoldMappings, lowerMappings, titleMappings } from "../unicode-case-data.js";
import { isUnicodeCharacter } from "./unicode-character-classification.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { renderQuotedPoints } from "./quoted-representation.js";
import { renderIntegerPercentBuffer, type IntegerPercentField } from "./integer-percent-field.js";
import { renderFloatPercentBuffer, type FloatPercentField } from "./float-percent-field.js";
import { renderIntegerRadixFormat } from "./integer-radix-format.js";
import { renderFloatFormatBuffer } from "./float-format-field.js";
import { renderComplexFormatBuffer } from "./complex-format-field.js";
import type { FormatSpec } from "./format-spec.js";
import type { NumericLocale } from "./numeric-locale.js";

// Module-private capability: only freshly generated, already charged buffers
// may bypass public input copying and validation. Never export this marker.
const ownedPoints = Symbol("owned code points");
const finalSigmaMapping: readonly number[] = Object.freeze([0x3c2]);
export type StringCaseTransformation = "upper" | "casefold" | "lower" | "title" | "capitalize" | "swapcase";

/** Internal immutable string storage, not the guest str object/protocol itself.
 * Surrogates remain individual code points; no UTF-16 round trip is performed.
 */
export class CodePointString implements Iterable<number> {
  readonly #points: Uint32Array;
  readonly length: number;

  constructor(points: Uint32Array, meter?: ExecutionMeter, ownership?: typeof ownedPoints) {
    const adopt = ownership === ownedPoints;
    meter?.checkpoint(1, adopt ? 0 : points.byteLength);
    this.#points = adopt ? points : new Uint32Array(points.length);
    if (!adopt) {
      for (let index = 0; index < this.#points.length; index++) {
        meter?.checkpoint();
        const point = points[index]!;
        if (point > 0x10ffff) throw new PythonRuntimeError("ValueError", "string code point outside Unicode range");
        this.#points[index] = point;
      }
    }
    this.length = this.#points.length;
    Object.freeze(this);
  }

  /** Hexadecimal bytes need ASCII output only, built directly into owned points. */
  static fromBytesHex(bytes: ImmutableBytes, separator: number | null, group: number, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (separator !== null && (!Number.isInteger(separator) || separator < 0 || separator > 127)) throw new RangeError("hex separator must be ASCII");
    if (!Number.isSafeInteger(group)) throw new RangeError("hex group size must be a safe integer");
    const size = Math.abs(group), separators = separator === null || size === 0 || bytes.length === 0 ? 0 : Math.floor((bytes.length - 1) / size);
    const length = bytes.length * 2 + separators;
    if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    let index = 0, offset = 0;
    for (const byte of bytes) {
      meter.checkpoint();
      if (separator !== null && size !== 0 && index > 0 && (group > 0 ? bytes.length - index : index) % size === 0) points[offset++] = separator;
      const high = byte >>> 4, low = byte & 15;
      points[offset++] = high < 10 ? 48 + high : 87 + high;
      points[offset++] = low < 10 ? 48 + low : 87 + low;
      index++;
    }
    return new CodePointString(points, meter, ownedPoints);
  }

  *[Symbol.iterator](): IterableIterator<number> {
    for (let index = 0; index < this.length; index++) yield this.#points[index]!;
  }

  codePointAt(index: bigint, meter?: ExecutionMeter): number {
    meter?.checkpoint();
    // String indexing uses the guest's signed 64-bit index model, unlike range.
    if (BigInt.asIntN(64, index) !== index) throw new PythonRuntimeError("IndexError", "cannot fit 'int' into an index-sized integer");
    if (index < 0n) index += BigInt(this.length);
    if (index < 0n || index >= BigInt(this.length)) throw new PythonRuntimeError("IndexError", "string index out of range");
    return this.#points[Number(index)]!;
  }

  slice(start: bigint | null = null, stop: bigint | null = null, step: bigint | null = null, meter?: ExecutionMeter): CodePointString {
    meter?.checkpoint();
    const indices = normalizeSlice(BigInt(this.length), start, stop, step);
    if (indices.step === 1n) {
      if (indices.start === 0n && indices.stop === BigInt(this.length)) return this;
      return new CodePointString(this.#points.subarray(Number(indices.start), Number(indices.stop)), meter);
    }
    const count = Number(indices.length);
    meter?.checkpoint(0, count * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(count);
    // With at least two elements, the stride is bounded by the stored length.
    // Otherwise an arbitrary-size step need never be converted to a JS number.
    const stride = count > 1 ? Number(indices.step) : 0;
    for (let offset = 0, index = Number(indices.start); offset < count; offset++, index += stride) {
      meter?.checkpoint();
      points[offset] = this.#points[index]!;
    }
    return new CodePointString(points, meter, ownedPoints);
  }

  repeat(count: number, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("repeat requires a nonnegative safe integer");
    if (this.length === 0 || count === 1) return this;
    const length = this.length * count;
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    for (let i = 0; i < length; i++) { meter.checkpoint(); points[i] = this.#points[i % this.length]; }
    return new CodePointString(points, meter, ownedPoints);
  }

  concat(other: CodePointString, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (this.length === 0) return other;
    if (other.length === 0) return this;
    meter.checkpoint(0, (this.length + other.length) * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(this.length + other.length);
    for (let i = 0; i < this.length; i++) { meter.checkpoint(); points[i] = this.#points[i]; }
    for (let i = 0; i < other.length; i++) { meter.checkpoint(); points[this.length + i] = other.#points[i]; }
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Precompute total size and fill one owned output buffer, avoiding repeated
   * concatenation. Parts are trusted immutable storage, already validated. */
  join(parts: readonly CodePointString[], meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (parts.length === 1) return parts[0];
    let length = 0;
    for (let i = 0; i < parts.length; i++) {
      meter.checkpoint();
      length += parts[i].length + (i === 0 ? 0 : this.length);
      if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    }
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      meter.checkpoint();
      if (i !== 0) for (const point of this.#points) { meter.checkpoint(); points[offset++] = point; }
      for (const point of parts[i].#points) { meter.checkpoint(); points[offset++] = point; }
    }
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Adopt the shared renderer's fresh, charged buffer without a second copy. */
  static fromBytesRepr(source: ImmutableBytes, meter: ExecutionMeter): CodePointString {
    const points = renderQuotedPoints(source, "bytes", meter);
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Take sole ownership of a preflighted numeric percent-field buffer. */
  static fromIntegerPercentField(value: bigint, field: IntegerPercentField, meter: ExecutionMeter, maxDecimalDigits?: number): CodePointString {
    const points = renderIntegerPercentBuffer(value, field, Uint32Array, meter, maxDecimalDigits);
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Adopt the integer radix renderer's final buffer without copying. */
  static fromIntegerRadixFormat(value: bigint, field: FormatSpec, meter: ExecutionMeter, maxDecimalDigits?: number, locale?: NumericLocale): CodePointString {
    const points = renderIntegerRadixFormat(value, field, meter, maxDecimalDigits, locale);
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Adopt the floating renderer's final buffer without copying. */
  static fromFloatFormat(value: number, field: FormatSpec, meter: ExecutionMeter, locale?: NumericLocale): CodePointString {
    const points = renderFloatFormatBuffer(value, field, meter, true, locale);
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Adopt the composed complex renderer's final buffer without copying. */
  static fromComplexFormat(real: number, imaginary: number, field: FormatSpec, meter: ExecutionMeter, locale?: NumericLocale): CodePointString {
    const points = renderComplexFormatBuffer(real, imaginary, field, meter, locale);
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Adopt the floating percent renderer's final buffer without copying. */
  static fromFloatPercentField(value: number, field: FloatPercentField, meter: ExecutionMeter): CodePointString {
    const points = renderFloatPercentBuffer(value, field, Uint32Array, meter);
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Escape only non-ASCII points of an already-produced representation. ASCII
   * syntax/controls stay literal; unchanged immutable storage can be shared. */
  escapeAscii(meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    let length = 0;
    for (const point of this.#points) {
      meter.checkpoint();
      length += point < 128 ? 1 : point <= 255 ? 4 : point <= 65535 ? 6 : 10;
      if (length > 0xffffffff) exhaustAllocation(meter);
    }
    if (length === this.length) return this;
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    let offset = 0;
    for (const point of this.#points) {
      meter.checkpoint();
      if (point < 128) { points[offset++] = point; continue; }
      const digits = point <= 255 ? 2 : point <= 65535 ? 4 : 8;
      points[offset++] = 92;
      points[offset++] = digits === 2 ? 120 : digits === 4 ? 117 : 85;
      for (let shift = (digits - 1) * 4; shift >= 0; shift -= 4) {
        meter.checkpoint();
        const digit = point >>> shift & 15;
        points[offset++] = digit < 10 ? 48 + digit : 87 + digit;
      }
    }
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Python str repr/ascii with pinned Unicode printability and sole ownership
   * of the shared renderer's fresh, preflighted code-point buffer. */
  repr(ascii: boolean, meter: ExecutionMeter): CodePointString {
    const points = renderQuotedPoints(this, ascii ? "ascii" : "repr", meter);
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Render an already converted text field with normalized dimensions.
   * Precision truncation precedes fill padding; neither uses UTF-16 lengths.
   * Fuse both operations into one preflighted owned allocation. Numeric fields
   * have different sign/zero/precision rules and do not use this operation. */
  formatField(width: bigint, precision: bigint | null, alignment: "left" | "right" | "center", fill: number, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (width < 0n || (precision !== null && precision < 0n)) throw new RangeError("field dimensions must be nonnegative");
    if (!Number.isInteger(fill) || fill < 0 || fill > 0x10ffff) throw new RangeError("padding requires a valid code point");
    const count = precision === null || precision >= BigInt(this.length) ? this.length : Number(precision);
    if (width <= BigInt(count) && count === this.length) return this;
    if (width > 0xffffffffn) exhaustAllocation(meter);
    const length = Math.max(count, Number(width));
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length), padding = length - count;
    const start = alignment === "left" ? 0 : alignment === "center" ? Math.floor(padding / 2) : padding;
    let offset = 0;
    while (offset < start) { meter.checkpoint(); points[offset++] = fill; }
    for (let index = 0; index < count; index++) { meter.checkpoint(); points[offset++] = this.#points[index]; }
    while (offset < length) { meter.checkpoint(); points[offset++] = fill; }
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Full locale-independent mappings can expand one code point into several.
   * Preflight the result size, then fill a single owned buffer. */
  transformCase(mode: StringCaseTransformation, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (this.length === 0) return this;
    let length = 0, previousCased = false;
    for (let index = 0; index < this.length; index++) {
      meter.checkpoint();
      length += this.#caseMapping(mode, index, previousCased, meter)?.length ?? 1;
      if (mode === "title") previousCased = isUnicodeCharacter(this.#points[index], "cased", meter);
      if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    }
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    let offset = 0;
    previousCased = false;
    for (let index = 0; index < this.length; index++) {
      meter.checkpoint();
      const point = this.#points[index];
      const mapping = this.#caseMapping(mode, index, previousCased, meter);
      if (mode === "title") previousCased = isUnicodeCharacter(point, "cased", meter);
      if (mapping === undefined) points[offset++] = point;
      else for (const mapped of mapping) { meter.checkpoint(); points[offset++] = mapped; }
    }
    return new CodePointString(points, meter, ownedPoints);
  }

  #caseMapping(mode: StringCaseTransformation, index: number, previousCased: boolean, meter: ExecutionMeter): readonly number[] | undefined {
    const point = this.#points[index];
    switch (mode) {
      case "upper": return upperMappings[point];
      case "casefold": return casefoldMappings[point];
      case "capitalize": if (index === 0) return titleMappings[point]; break;
      case "title": if (!previousCased) return titleMappings[point]; break;
      case "swapcase":
        if (!isUnicodeCharacter(point, "isupper", meter)) {
          return isUnicodeCharacter(point, "islower", meter) ? upperMappings[point] : undefined;
        }
        break;
      case "lower": break;
    }
    return point === 0x3a3 && this.#isFinalSigma(index, meter) ? finalSigmaMapping : lowerMappings[point];
  }

  /** Sigma itself is not case-ignorable, so neighboring sigma context scans
   * cannot overlap beyond their intervening ignorable run: total linear work. */
  #isFinalSigma(index: number, meter: ExecutionMeter): boolean {
    let previous = index - 1;
    while (previous >= 0 && isUnicodeCharacter(this.#points[previous], "caseIgnorable", meter)) previous--;
    if (previous < 0 || !isUnicodeCharacter(this.#points[previous], "cased", meter)) return false;
    let next = index + 1;
    while (next < this.length && isUnicodeCharacter(this.#points[next], "caseIgnorable", meter)) next++;
    return next === this.length || !isUnicodeCharacter(this.#points[next], "cased", meter);
  }

  /** Size the expanded text first, then fill one owned buffer. Only CR/LF reset
   * columns; all other non-tab code points occupy one column. */
  expandTabs(tabsize: number, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (!Number.isSafeInteger(tabsize)) throw new RangeError("tab size must be a safe integer");
    let length = 0, column = 0, changed = false;
    for (const point of this.#points) {
      meter.checkpoint();
      if (point === 9) {
        changed = true;
        const spaces = tabsize > 0 ? tabsize - column % tabsize : 0;
        length += spaces; column += spaces;
      } else { length++; column = point === 10 || point === 13 ? 0 : column + 1; }
      if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    }
    if (!changed) return this;
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    let offset = 0;
    column = 0;
    for (const point of this.#points) {
      meter.checkpoint();
      if (point === 9) {
        const spaces = tabsize > 0 ? tabsize - column % tabsize : 0;
        const end = offset + spaces;
        while (offset < end) { meter.checkpoint(); points[offset++] = 32; }
        column += spaces;
      } else { points[offset++] = point; column = point === 10 || point === 13 ? 0 : column + 1; }
    }
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Fill a single final buffer. Width is code points, not UTF-16 units or
   * terminal columns. Sign alignment preserves an ASCII leading +/- prefix. */
  pad(width: bigint, alignment: "left" | "right" | "center" | "sign", fill: number, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (!Number.isInteger(fill) || fill < 0 || fill > 0x10ffff) throw new RangeError("padding requires a valid code point");
    if (width <= BigInt(this.length)) return this;
    if (width > 0xffffffffn) exhaustAllocation(meter);
    const length = Number(width), padding = length - this.length;
    const left = alignment === "left" ? 0 : alignment === "center"
      ? Math.floor(padding / 2) + (padding % 2) * (length % 2) : padding;
    const sign = alignment === "sign" && (this.#points[0] === 43 || this.#points[0] === 45) ? 1 : 0;
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    let offset = 0;
    if (sign) { meter.checkpoint(); points[offset++] = this.#points[0]; }
    for (let index = 0; index < left; index++) { meter.checkpoint(); points[offset++] = fill; }
    for (let index = sign; index < this.length; index++) { meter.checkpoint(); points[offset++] = this.#points[index]; }
    while (offset < length) { meter.checkpoint(); points[offset++] = fill; }
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Count selected matches, then fill one exact-size owned output buffer.
   * Two bounded scans avoid storing every match offset or repeated concatenation. */
  replace(old: CodePointString, replacement: CodePointString, count: bigint, meter: ExecutionMeter): CodePointString {
    meter.checkpoint();
    if (count === 0n || old.length > this.length || (old.length === 0 && replacement.length === 0)) return this;
    const limit = count < 0n || count > BigInt(this.length) + 1n ? this.length + 1 : Number(count);
    let matches = 0;
    if (old.length === 0) matches = Math.min(limit, this.length + 1);
    else for (const ignoredIndex of substringMatches(this.#points, old.#points, false, meter)) {
      if (++matches === limit) break;
    }
    if (matches === 0) return this;
    const length = this.length + matches * (replacement.length - old.length);
    if (!Number.isSafeInteger(length) || length > 0xffffffff) exhaustAllocation(meter);
    meter.checkpoint(0, length * Uint32Array.BYTES_PER_ELEMENT);
    const points = new Uint32Array(length);
    let offset = 0, source = 0;
    if (old.length === 0) {
      for (let boundary = 0; boundary <= this.length; boundary++) {
        meter.checkpoint();
        if (boundary < matches) for (const point of replacement.#points) { meter.checkpoint(); points[offset++] = point; }
        if (boundary < this.length) { meter.checkpoint(); points[offset++] = this.#points[boundary]; }
      }
    } else {
      let remaining = matches;
      for (const index of substringMatches(this.#points, old.#points, false, meter)) {
        while (source < index) { meter.checkpoint(); points[offset++] = this.#points[source++]; }
        for (const point of replacement.#points) { meter.checkpoint(); points[offset++] = point; }
        source = index + old.length;
        if (--remaining === 0) break;
      }
      while (source < this.length) { meter.checkpoint(); points[offset++] = this.#points[source++]; }
    }
    return new CodePointString(points, meter, ownedPoints);
  }

  /** Emits pieces in scan order (rightmost first for reverse splitting).
   * The guest list layer restores forward order after a reverse scan. */
  *split(separator: CodePointString | null, maxsplit: bigint, reverse: boolean, meter: ExecutionMeter): IterableIterator<CodePointString> {
    meter.checkpoint(1, 64);
    let remaining = maxsplit < 0n ? BigInt(this.length) + 1n : maxsplit;
    if (separator !== null) {
      if (separator.length === 0) throw new PythonRuntimeError("ValueError", "empty separator");
      let boundary = reverse ? this.length : 0;
      if (remaining !== 0n) for (const index of substringMatches(this.#points, separator.#points, reverse, meter)) {
        yield this.slice(BigInt(reverse ? index + separator.length : boundary), BigInt(reverse ? boundary : index), null, meter);
        boundary = reverse ? index : index + separator.length;
        if (--remaining === 0n) break;
      }
      yield this.slice(BigInt(reverse ? 0 : boundary), BigInt(reverse ? boundary : this.length), null, meter);
      return;
    }
    const step = reverse ? -1 : 1;
    let index = reverse ? this.length - 1 : 0;
    while (index >= 0 && index < this.length) {
      while (index >= 0 && index < this.length) {
        meter.checkpoint();
        if (!isUnicodeWhitespace(this.#points[index])) break;
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
        if (isUnicodeWhitespace(this.#points[index])) break;
        index += step;
      }
      yield this.slice(BigInt(reverse ? index + 1 : start), BigInt(reverse ? start + 1 : index), null, meter);
      remaining--;
    }
  }

  search(needle: CodePointString, mode: SearchMode, start = 0n, stop: bigint | null = null, meter?: ExecutionMeter): number {
    meter?.checkpoint();
    const length = BigInt(this.length);
    if (start < 0n) start += length;
    if (start < 0n) start = 0n;
    stop ??= length;
    if (stop < 0n) stop += length;
    if (stop < 0n) stop = 0n;
    if (stop > length) stop = length;
    // Unlike slice normalization, start beyond the end cannot match even ''.
    if (start > stop || BigInt(needle.length) > stop - start) return mode === "count" ? 0 : -1;
    if (needle.length === 0) return Number(mode === "find" ? start : mode === "rfind" ? stop : stop - start + 1n);
    return searchSubstring(this.#points, needle.#points, Number(start), Number(stop), mode, meter);
  }

  /** Match a boundary in-place; neither slice nor scan the rest of the text. */
  hasAffix(affix: CodePointString, side: "start" | "end", start = 0n, stop: bigint | null = null, meter?: ExecutionMeter): boolean {
    meter?.checkpoint();
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
    meter?.checkpoint();
    if (this.#points[offset] !== affix.#points[0] || this.#points[offset + affix.length - 1] !== affix.#points[affix.length - 1]) return false;
    for (let index = 1; index < affix.length - 1; index++) {
      meter?.checkpoint();
      if (this.#points[offset + index] !== affix.#points[index]) return false;
    }
    return true;
  }

  compare(other: CodePointString, meter?: ExecutionMeter): -1 | 0 | 1 {
    meter?.checkpoint();
    const common = Math.min(this.length, other.length);
    for (let index = 0; index < common; index++) {
      meter?.checkpoint();
      if (this.#points[index]! < other.#points[index]!) return -1;
      if (this.#points[index]! > other.#points[index]!) return 1;
    }
    return this.length < other.length ? -1 : this.length > other.length ? 1 : 0;
  }
}
