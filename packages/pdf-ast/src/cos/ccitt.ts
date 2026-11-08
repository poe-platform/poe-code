import { readBytes } from "@poe-code/safe-fs/contracts";
import { PdfError } from "../errors.js";
import type { PdfFilterDecodeParms } from "./filters.js";
import type { PdfInflateOptions } from "./flate-stream.js";
import type { PdfPredictorOptions } from "./predictor-stream.js";

export interface PdfCcittOptions extends PdfInflateOptions, PdfPredictorOptions {}
type Steps<T> = Generator<"input" | Uint8Array, T, void>;
interface Limits { columns: number; rowBytes: number; chunkBytes: number; maximum: number }
function admit(parms: PdfFilterDecodeParms | undefined, options: PdfCcittOptions): Limits {
  const columns = Math.max(1, parms?.Columns ?? 1728);
  const rowBytes = Math.ceil(columns / 8);
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maximum = options.maxDecodedBytes ?? Infinity;
  const maxRowBytes = options.maxRowBytes ?? Infinity;
  if (!Number.isSafeInteger(columns)) throw new PdfError("E_CAPABILITY", "Invalid CCITT column count");
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError("Invalid chunkBytes");
  for (const [name, value] of [["maxDecodedBytes", maximum], ["maxRowBytes", maxRowBytes]] as const) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError(`Invalid ${name}`);
  }
  if (rowBytes > maxRowBytes) throw new PdfError("E_LIMIT", "CCITT row byte limit exceeded");
  return { columns, rowBytes, chunkBytes, maximum };
}

class BitInput {
  bytes: Uint8Array = new Uint8Array(0);
  position = 0;
  eof = false;
  private current = 0;
  private remaining = 0;
  *available(): Steps<boolean> {
    if (this.remaining) return true;
    while (this.position === this.bytes.length) {
      if (this.eof) return false;
      yield "input";
    }
    return true;
  }
  *bit(): Steps<number | undefined> {
    if (!this.remaining) {
      if (!(yield* this.available())) return undefined;
      this.current = this.bytes[this.position++]!;
      this.remaining = 8;
    }
    return (this.current >>> --this.remaining) & 1;
  }
  align(): void { this.remaining = 0; }
}
function pixel(row: Uint8Array, x: number): number { return (row[Math.floor(x / 8)]! >>> (7 - x % 8)) & 1; }
function paint(row: Uint8Array, start: number, end: number, color: number): void {
  while (start < end && start % 8) {
    const index = Math.floor(start / 8), mask = 1 << (7 - start % 8);
    row[index] = color ? row[index]! | mask : row[index]! & ~mask;
    start++;
  }
  const aligned = end - end % 8;
  if (aligned > start) { row.fill(color ? 255 : 0, start / 8, aligned / 8); start = aligned; }
  while (start < end) {
    const index = Math.floor(start / 8), mask = 1 << (7 - start % 8);
    row[index] = color ? row[index]! | mask : row[index]! & ~mask;
    start++;
  }
}

const CCITT_WHITE_CODES: ReadonlyMap<string, number> = new Map([
  ["00110101", 0], ["000111", 1], ["0111", 2], ["1000", 3], ["1011", 4], ["1100", 5], ["1110", 6], ["1111", 7],
  ["10011", 8], ["10100", 9], ["00111", 10], ["01000", 11], ["001000", 12], ["000011", 13], ["110100", 14], ["110101", 15],
  ["101010", 16], ["101011", 17], ["0100111", 18], ["0001100", 19], ["0001000", 20], ["0010111", 21], ["0000011", 22], ["0000100", 23],
  ["0101000", 24], ["0101011", 25], ["0010011", 26], ["0100100", 27], ["0011000", 28], ["00000010", 29], ["00000011", 30], ["00011010", 31],
  ["00011011", 32], ["00010010", 33], ["00010011", 34], ["00010100", 35], ["00010101", 36], ["00010110", 37], ["00010111", 38], ["00101000", 39],
  ["00101001", 40], ["00101010", 41], ["00101011", 42], ["00101100", 43], ["00101101", 44], ["00000100", 45], ["00000101", 46], ["00001010", 47],
  ["00001011", 48], ["01010010", 49], ["01010011", 50], ["01010100", 51], ["01010101", 52], ["00100100", 53], ["00100101", 54], ["01011000", 55],
  ["01011001", 56], ["01011010", 57], ["01011011", 58], ["01001010", 59], ["01001011", 60], ["00110010", 61], ["00110011", 62], ["00110100", 63],
  ["11011", 64], ["10010", 128], ["010111", 192], ["0110111", 256], ["00110110", 320], ["00110111", 384], ["01100100", 448], ["01100101", 512],
  ["01101000", 576], ["01100111", 640], ["010011011", 1728],
]);

const CCITT_BLACK_CODES: ReadonlyMap<string, number> = new Map([
  ["0000110111", 0], ["010", 1], ["11", 2], ["10", 3], ["011", 4], ["0011", 5], ["0010", 6], ["00011", 7],
  ["000101", 8], ["000100", 9], ["0000100", 10], ["0000101", 11], ["0000111", 12], ["00000100", 13], ["00000111", 14], ["000011000", 15],
  ["0000010111", 16], ["0000011000", 17], ["0000001000", 18], ["00001100111", 19], ["00001101000", 20], ["00001101100", 21], ["00000110111", 22], ["00000101000", 23],
  ["00000010111", 24], ["00000011000", 25], ["000011001010", 26], ["000011001011", 27], ["000011001100", 28], ["000011001101", 29], ["000001101000", 30], ["000001101001", 31],
  ["000001101010", 32], ["000001101011", 33], ["000011010010", 34], ["000011010011", 35], ["000011010100", 36], ["000011010101", 37], ["000011010110", 38], ["000011010111", 39],
  ["000001101100", 40], ["000001101101", 41], ["000011011010", 42], ["000011011011", 43], ["000001010100", 44], ["000001010101", 45], ["000001010110", 46], ["000001010111", 47],
  ["000001100100", 48], ["000001100101", 49], ["000001010010", 50], ["000001010011", 51], ["000000100100", 52], ["000000110111", 53], ["000000111000", 54], ["000000100111", 55],
  ["000000101000", 56], ["000001011000", 57], ["000001011001", 58], ["000000101011", 59], ["000000101100", 60], ["000001011010", 61], ["000001100110", 62], ["000001100111", 63],
  ["0000001111", 64], ["000011001000", 128], ["000011001001", 192], ["000001011011", 256],
]);

function* decodeRows(input: BitInput, parms: PdfFilterDecodeParms | undefined, limits: Limits): Steps<boolean> {
  const { columns, rowBytes, chunkBytes, maximum } = limits;
  const maxRows = parms?.Rows && parms.Rows > 0 ? parms.Rows : Infinity;
  const k = parms?.K ?? 0;
  const blackIs1 = parms?.BlackIs1 ?? false;
  const byteAlign = parms?.EncodedByteAlign ?? false;
  function* readRunLength(isBlack: boolean): Steps<number | undefined> {
    const table = isBlack ? CCITT_BLACK_CODES : CCITT_WHITE_CODES;
    let totalRun = 0;
    while (true) {
      let prefix = "";
      let matched: number | undefined;
      for (let len = 1; len <= 13; len++) {
        const bit = yield* input.bit();
        if (bit === undefined) return undefined;
        prefix += bit ? "1" : "0";
        if (prefix === "000000000001") return undefined; // EOL / EOFB
        const val = table.get(prefix);
        if (val !== undefined) {
          matched = val;
          break;
        }
      }
      if (matched === undefined) return undefined;
      totalRun = Math.min(columns, totalRun + matched);
      if (matched < 64) return totalRun;
    }
  }

  let rowCount = 0;
  let decodedBytes = 0;
  let refLine = new Uint8Array(rowBytes);
  let curLine = new Uint8Array(rowBytes);
  while (rowCount < maxRows) {
    if (byteAlign) input.align();
    if (!(yield* input.available())) break;
    curLine.fill(0);
    if (k < 0) {
      // Group 4 2D decoding
      let a0 = -1;
      let curColor = 0; // 0 = white, 1 = black
      let eofb = false;
      while ((a0 < 0 ? 0 : a0) < columns) {
        let modePrefix = "";
        let mode: string | undefined;
        for (let len = 1; len <= 12; len++) {
          const bit = yield* input.bit();
          if (bit === undefined) {
            eofb = true;
            break;
          }
          modePrefix += bit ? "1" : "0";
          if (modePrefix === "1") { mode = "V0"; break; }
          if (modePrefix === "011") { mode = "VR1"; break; }
          if (modePrefix === "010") { mode = "VL1"; break; }
          if (modePrefix === "001") { mode = "H"; break; }
          if (modePrefix === "0001") { mode = "P"; break; }
          if (modePrefix === "000011") { mode = "VR2"; break; }
          if (modePrefix === "000010") { mode = "VL2"; break; }
          if (modePrefix === "0000011") { mode = "VR3"; break; }
          if (modePrefix === "0000010") { mode = "VL3"; break; }
          if (modePrefix === "000000000001") {
            eofb = true;
            break;
          }
        }
        if (eofb || !mode) break;

        const startPos = a0 < 0 ? 0 : a0;
        // Find b1 (first changing element on refLine to the right of a0 with opposite color of curColor)
        let b1 = columns;
        for (let x = a0 < 0 ? 0 : a0 + 1; x < columns; x++) {
          const prevColor = x === 0 ? 0 : pixel(refLine, x - 1);
          if (pixel(refLine, x) !== prevColor && pixel(refLine, x) === (1 - curColor)) {
            b1 = x;
            break;
          }
        }
        let b2 = columns;
        for (let x = b1 + 1; x < columns; x++) {
          if (pixel(refLine, x) !== pixel(refLine, x - 1)) {
            b2 = x;
            break;
          }
        }

        if (mode === "P") {
          paint(curLine, startPos, Math.min(columns, b2), curColor);
          a0 = b2;
        } else if (mode === "H") {
          const r1 = (yield* readRunLength(curColor === 1)) ?? 0;
          const r2 = (yield* readRunLength(curColor === 0)) ?? 0;
          const a1 = Math.min(columns, startPos + r1);
          const a2 = Math.min(columns, a1 + r2);
          paint(curLine, startPos, a1, curColor);
          paint(curLine, a1, a2, 1 - curColor);
          a0 = a2;
        } else {
          let offset = 0;
          if (mode === "VR1") offset = 1;
          else if (mode === "VR2") offset = 2;
          else if (mode === "VR3") offset = 3;
          else if (mode === "VL1") offset = -1;
          else if (mode === "VL2") offset = -2;
          else if (mode === "VL3") offset = -3;
          const a1 = Math.max(startPos, Math.min(columns, b1 + offset));
          paint(curLine, startPos, a1, curColor);
          a0 = a1;
          curColor = 1 - curColor;
        }
      }
      if (eofb && a0 < 0) break;
    } else {
      // Group 3 1D decoding
      let xPos = 0;
      let isBlack = false;
      let aborted = false;
      while (xPos < columns) {
        const run = yield* readRunLength(isBlack);
        if (run === undefined) {
          aborted = xPos === 0;
          break;
        }
        const endX = Math.min(columns, xPos + run);
        if (isBlack) {
          paint(curLine, xPos, endX, 1);
        }
        xPos = endX;
        isBlack = !isBlack;
      }
      if (aborted) break;
    }

    if (rowBytes > Math.min(maximum, Number.MAX_SAFE_INTEGER) - decodedBytes) throw new PdfError("E_LIMIT", "CCITT decoded byte limit exceeded");
    decodedBytes += rowBytes;
    for (let offset = 0; offset < rowBytes; offset += chunkBytes) {
      const chunk = curLine.slice(offset, offset + chunkBytes);
      if (!blackIs1) for (let i = 0; i < chunk.length; i++) chunk[i] = chunk[i]! ^ 255;
      if (offset + chunk.length === rowBytes && columns % 8) chunk[chunk.length - 1] = chunk[chunk.length - 1]! & (255 << (8 - columns % 8));
      yield chunk;
    }
    rowCount++;
    const reusable = refLine;
    refLine = curLine;
    curLine = reusable;
  }
  return rowCount > 0;
}

/** Buffering convenience API over the same row decoder as the streaming path. */
export function decodeCcittFax(bytes: Uint8Array, parms?: PdfFilterDecodeParms): Uint8Array {
  const input = new BitInput();
  input.bytes = bytes; input.eof = true;
  const work = decodeRows(input, parms, admit(parms, {}));
  const chunks: Uint8Array[] = [];
  let length = 0;
  let step = work.next();
  while (!step.done) {
    if (step.value === "input") throw new Error("Unexpected CCITT input request");
    chunks.push(step.value); length += step.value.length;
    step = work.next();
  }
  if (!step.value) return bytes;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/** A fresh input iterator must replay the same retained bytes. This preserves the
 * original-byte fallback without buffering the encoded payload or using private
 * storage. Successful decoding retains two packed rows and one borrowed chunk. */
export async function* decodeCcittFaxChunks(open: () => AsyncIterable<Uint8Array>, parms?: PdfFilterDecodeParms, options: PdfCcittOptions = {}): AsyncGenerator<Uint8Array> {
  const limits = admit(parms, options);
  const { signal } = options;
  signal?.throwIfAborted();
  const input = new BitInput();
  const iterator = readBytes(open(), signal);
  const work = decodeRows(input, parms, limits);
  let decoded = false, failed = false, turns = 0;
  try {
    let step = work.next();
    while (!step.done) {
      signal?.throwIfAborted();
      if (step.value === "input") {
        const next = await iterator.next();
        input.bytes = next.done ? new Uint8Array(0) : next.value;
        input.position = 0; input.eof = !!next.done;
      } else yield step.value;
      if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      step = work.next();
    }
    decoded = step.value;
  } catch (error) { failed = true; throw error; }
  finally {
    work.return(false);
    await iterator.return(undefined).catch(error => { if (!failed) throw error; });
  }
  signal?.throwIfAborted();
  if (!decoded) {
    let total = 0;
    for await (const chunk of readBytes(open(), signal)) {
      if (chunk.length > Math.min(limits.maximum, Number.MAX_SAFE_INTEGER) - total) throw new PdfError("E_LIMIT", "CCITT fallback byte limit exceeded");
      total += chunk.length;
      for (let offset = 0; offset < chunk.length; offset += limits.chunkBytes) {
        signal?.throwIfAborted(); yield chunk.slice(offset, offset + limits.chunkBytes);
      }
    }
  }
}
