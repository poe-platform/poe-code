// Zlib recovery and Huffman decoding adapted from Mozilla PDF.js FlateStream.
// Copyright Mozilla Foundation; Apache-2.0. See THIRD_PARTY_NOTICES.md.
// Modified to suspend on input/output and retain a 32 KiB history, not all output.
import { ByteCodecError, createByteCodec } from "@poe-code/compression";
import { readBytes } from "@poe-code/safe-fs/contracts";
import { PdfError } from "../errors.js";

export interface PdfInflateOptions {
  readonly chunkBytes?: number;
  readonly maxDecodedBytes?: number;
  readonly signal?: AbortSignal;
}

type Step<T> = Generator<"input" | Uint8Array, T, void>;
type Huffman = readonly [Int32Array, number];
class Truncated extends Error {}
function invalid(): PdfError { return new PdfError("E_CAPABILITY", "Invalid FlateDecode compressed stream"); }

class Input {
  bytes: Uint8Array = new Uint8Array(0);
  position = 0;
  eof = false;
  buffer = 0;
  count = 0;
  *byte(): Step<number> {
    while (this.position === this.bytes.length) {
      if (this.eof) return -1;
      yield "input";
    }
    return this.bytes[this.position++]!;
  }
  *bits(count: number): Step<number> {
    while (this.count < count) {
      const byte = yield* this.byte();
      if (byte < 0) throw new Truncated();
      this.buffer |= byte << this.count;
      this.count += 8;
    }
    const result = this.buffer & ((1 << count) - 1);
    this.buffer >>>= count;
    this.count -= count;
    return result;
  }
  *code([codes, maximum]: Huffman): Step<number> {
    while (this.count < maximum) {
      const byte = yield* this.byte();
      if (byte < 0) break;
      this.buffer |= byte << this.count;
      this.count += 8;
    }
    const code = codes[this.buffer & ((1 << maximum) - 1)] ?? 0;
    const length = code >>> 16;
    if (length < 1) throw invalid();
    if (this.count < length) throw new Truncated();
    this.buffer >>>= length;
    this.count -= length;
    return code & 65535;
  }
}

function huffman(lengths: Uint8Array): Huffman {
  let maximum = 0;
  for (const length of lengths) maximum = Math.max(maximum, length);
  // Dynamic lengths are decoded from the format's 0..15 alphabet. No input
  // count controls an unbounded table allocation.
  if (maximum > 15) throw invalid();
  const size = 1 << maximum;
  const codes = new Int32Array(size);
  for (let length = 1, code = 0, skip = 2; length <= maximum; length++, code <<= 1, skip <<= 1) {
    for (let value = 0; value < lengths.length; value++) {
      if (lengths[value] !== length) continue;
      let reversed = 0;
      for (let i = 0, bits = code; i < length; i++, bits >>>= 1) reversed = (reversed << 1) | (bits & 1);
      for (let i = reversed; i < size; i += skip) codes[i] = (length << 16) | value;
      code++;
    }
  }
  return [codes, maximum];
}
const literalLengths = new Uint8Array(288);
literalLengths.fill(8, 0, 144); literalLengths.fill(9, 144, 256);
literalLengths.fill(7, 256, 280); literalLengths.fill(8, 280);
const fixedLiteral = huffman(literalLengths);
const fixedDistance = huffman(new Uint8Array(32).fill(5));
const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const lengthOrder = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

class Output {
  readonly history: Uint8Array;
  total = 0;
  private buffer: Uint8Array | undefined;
  private used = 0;
  constructor(private readonly chunkBytes: number, private readonly maximum: number) {
    this.history = new Uint8Array(Math.min(32768, maximum));
  }
  admit(count: number): void {
    if (count > Math.min(this.maximum, Number.MAX_SAFE_INTEGER) - this.total) throw new PdfError("E_LIMIT", "FlateDecode output exceeds maximum decoded byte budget");
  }
  *byte(value: number): Step<void> {
    this.admit(1);
    this.buffer ??= new Uint8Array(Math.min(this.chunkBytes, this.maximum - this.total));
    this.buffer[this.used++] = value;
    this.history[this.total % this.history.length] = value;
    this.total++;
    if (this.used === this.buffer.length) {
      const ready = this.buffer;
      this.buffer = undefined;
      this.used = 0;
      yield ready;
    }
  }
  *finish(): Step<void> {
    if (this.used) yield this.buffer!.slice(0, this.used);
    this.buffer = undefined;
    this.used = 0;
  }
}

function* zlibBody(input: Input, output: Output): Step<void> {
  let last = false;
  try {
    while (!last) {
      let header: number;
      try { header = yield* input.bits(3); }
      catch (error) { if (error instanceof Truncated) break; throw error; }
      last = (header & 1) !== 0;
      const type = header >>> 1;
      if (type === 0) {
        // Like PDF.js, discard padding, accept the empty 0/0 length pair and
        // zero-fill a truncated stored block up to its admitted declared size.
        let length = 0;
        let check = 0;
        let complete = true;
        for (let i = 0; i < 4; i++) {
          const byte = yield* input.byte();
          if (byte < 0) { complete = false; break; }
          if (i < 2) length |= byte << (i * 8);
          else check |= byte << ((i - 2) * 8);
        }
        if (!complete) break;
        if (check !== (~length & 65535) && (length !== 0 || check !== 0)) throw invalid();
        input.buffer = 0; input.count = 0;
        output.admit(length);
        for (let i = 0; i < length; i++) {
          const byte = yield* input.byte();
          yield* output.byte(byte < 0 ? 0 : byte);
        }
        if (input.eof) break;
        continue;
      }
      let literals = fixedLiteral;
      let distances = fixedDistance;
      if (type === 2) {
        const literalCount = (yield* input.bits(5)) + 257;
        const distanceCount = (yield* input.bits(5)) + 1;
        const count = (yield* input.bits(4)) + 4;
        const lengths = new Uint8Array(19);
        for (let i = 0; i < count; i++) lengths[lengthOrder[i]!] = yield* input.bits(3);
        const table = huffman(lengths);
        const codes = new Uint8Array(literalCount + distanceCount);
        let previous = 0;
        for (let i = 0; i < codes.length;) {
          const code = yield* input.code(table);
          if (code < 16) { codes[i++] = previous = code; continue; }
          let repeat: number;
          if (code === 16) repeat = (yield* input.bits(2)) + 3;
          else if (code === 17) { repeat = (yield* input.bits(3)) + 3; previous = 0; }
          else if (code === 18) { repeat = (yield* input.bits(7)) + 11; previous = 0; }
          else throw invalid();
          while (repeat-- > 0) codes[i++] = previous;
        }
        literals = huffman(codes.subarray(0, literalCount));
        distances = huffman(codes.subarray(literalCount));
      } else if (type !== 1) throw invalid();
      while (true) {
        const code = yield* input.code(literals);
        if (code < 256) { yield* output.byte(code); continue; }
        if (code === 256) break;
        const lengthCode = code - 257;
        const length = (lengthBase[lengthCode] ?? 0) + (yield* input.bits(lengthExtra[lengthCode] ?? 0));
        const distanceCode = yield* input.code(distances);
        if (distanceCode > 29) throw invalid();
        const extra = distanceCode < 4 ? 0 : (distanceCode >>> 1) - 1;
        const distance = (distanceCode < 4 ? distanceCode + 1 : ((2 + (distanceCode & 1)) << extra) + 1) + (yield* input.bits(extra));
        output.admit(length);
        for (let i = 0; i < length; i++) {
          const value = distance > output.total ? 0 : output.history[(output.total - distance) % output.history.length]!;
          yield* output.byte(value);
        }
      }
    }
  } catch (error) {
    // The buffered decoder falls back to pypdf-style partial output when a
    // wrapped stream is truncated. Preserve that prefix without replay/buffering.
    if (!(error instanceof Truncated && output.total > 0)) throw error instanceof Truncated ? invalid() : error;
  }
  yield* output.finish();
}

/** Inflate PDF payloads before predictors. Output chunks are owned and bounded;
 * zlib recovery uses bounded Huffman tables plus a 32 KiB circular history. Raw and
 * gzip compatibility use the shared bounded codec. The caller owns input bytes. */
export async function* inflatePdfChunks(input: AsyncIterable<Uint8Array>, options: PdfInflateOptions = {}): AsyncGenerator<Uint8Array> {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maximum = options.maxDecodedBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError("Invalid chunkBytes");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid maxDecodedBytes");
  const { signal } = options;
  signal?.throwIfAborted();
  const iterator = readBytes(input, signal);
  let failed = false;
  try {
    const prefix = new Uint8Array(2);
    let count = 0;
    let remainder: Uint8Array = new Uint8Array(0);
    while (count < 2) {
      const step = await iterator.next();
      if (step.done) break;
      const take = Math.min(2 - count, step.value.length);
      prefix.set(step.value.subarray(0, take), count);
      count += take;
      remainder = step.value.subarray(take);
    }
    const zlib = count === 2 && (prefix[0]! & 15) === 8 && ((prefix[0]! << 8) | prefix[1]!) % 31 === 0;
    if (zlib && !(prefix[1]! & 32)) {
      const cursor = new Input();
      cursor.bytes = remainder;
      const work = zlibBody(cursor, new Output(chunkBytes, maximum));
      let turns = 0;
      try {
        let step = work.next();
        while (!step.done) {
          signal?.throwIfAborted();
          if (step.value === "input") {
            const next = await iterator.next();
            cursor.bytes = next.done ? new Uint8Array(0) : next.value;
            cursor.position = 0;
            cursor.eof = !!next.done;
          } else yield step.value;
          if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
          step = work.next();
        }
      } finally { work.return(undefined); }
    } else {
      const wrapped = zlib || (count === 2 && prefix[0] === 31 && prefix[1] === 139);
      const codec = createByteCodec({ direction: "decode", format: wrapped ? "zlib-or-gzip" : "raw", chunkSize: Math.max(1, Math.min(chunkBytes, maximum + 1)) });
      let total = 0;
      async function* encoded() {
        yield prefix.subarray(0, count);
        if (remainder.length) yield remainder;
        while (true) { const next = await iterator.next(); if (next.done) return; yield next.value; }
      }
      function* push(bytes: Uint8Array, final = false) {
        for (const chunk of codec.push(bytes, final)) {
          signal?.throwIfAborted();
          if (chunk.length > Math.min(maximum, Number.MAX_SAFE_INTEGER) - total) throw new PdfError("E_LIMIT", "FlateDecode output exceeds maximum decoded byte budget");
          total += chunk.length;
          yield chunk;
        }
      }
      try {
        for await (const bytes of encoded()) {
          yield* push(bytes);
          if (codec.complete) break;
        }
        if (!codec.complete) yield* push(new Uint8Array(0), true);
      } catch (error) {
        if (error instanceof PdfError || signal?.aborted) throw error;
        if (!(wrapped && error instanceof ByteCodecError && error.code === "truncated" && total > 0)) throw invalid();
      } finally { codec.close(); }
    }
    signal?.throwIfAborted();
  } catch (error) { failed = true; throw error; }
  finally { await iterator.return(undefined).catch(error => { if (!failed) throw error; }); }
}
