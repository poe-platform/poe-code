import { fail } from "../internal.js";
import { yieldTurn } from "../../../contracts/yield.js";

// Info-ZIP's file_read reserves a sentinel byte in each -ll read. STORE
// uses SBSZ; the Unix internal DEFLATE compressor initially requests 2*WSIZE.
export async function zipFromCrlf(bytes: Uint8Array, store: boolean, signal: AbortSignal, level = 6): Promise<Uint8Array> {
  signal.throwIfAborted();
  const window = store ? 16383 : 65535;
  let text = false;
  for (let index = 0; index < Math.min(bytes.length, window); index++) {
    if (index % 32768 === 0) await yieldTurn(signal);
    const byte = bytes[index]!;
    if (byte <= 6 || byte >= 14 && byte <= 25 || byte >= 28 && byte <= 31) return bytes;
    if (byte >= 32) text = true;
  }
  if (!text) return bytes;
  const output = new Uint8Array(bytes.length);
  let length = 0;
  let cursor = 0;
  // A native read reserves one byte for an LF sentinel. If conversion empties
  // the read, file_read consumes one more source byte (or retains CR at EOF).
  const read = (size: number): number => {
    const start = cursor;
    const end = Math.min(bytes.length, start + size - 1);
    if (start === end) return 0;
    cursor = end;
    const previous = length;
    for (let index = start; index < end; index++) {
      const byte = bytes[index]!;
      if (byte !== 13 || index + 1 < end && bytes[index + 1] !== 10) output[length++] = byte;
    }
    if (length === previous) output[length++] = cursor < bytes.length ? bytes[cursor++]! : bytes[end - 1]!;
    else if (output[length - 1] === 26) length--;
    return length - previous;
  };
  if (store || bytes.length <= window) {
    while (cursor < bytes.length) {
      await yieldTurn(signal);
      if (read(window + 1) === 0) break;
    }
  } else {
    await zipDeflateReads(output, read, () => length, level, signal);
  }
  return output.slice(0, length);
}

// Only the Unix Info-ZIP internal compressor's input schedule is modeled here;
// the existing codec still encodes the resulting bytes. Refill capacity depends
// on converted bytes, sliding, and fast/lazy match advancement, not I/O chunks.
async function zipDeflateReads(output: Uint8Array, read: (size: number) => number, length: () => number, level: number, signal: AbortSignal): Promise<void> {
  const profiles = [
    [0, 0, 0, 0], [4, 4, 8, 4], [4, 5, 16, 8], [4, 6, 32, 32],
    [4, 4, 16, 16], [8, 16, 32, 32], [8, 16, 128, 128],
    [8, 32, 128, 256], [32, 128, 258, 1024], [32, 258, 258, 4096],
  ];
  const profile = profiles[level];
  if (!profile || level === 0) fail("invalid from-crlf compression level");
  const [good, lazy, nice, chain] = profile as [number, number, number, number];
  // Absolute positions avoid copying/remapping the window on each slide.
  // Zero remains NIL; positions at/before the current window base are ignored.
  const head = new Float64Array(32768);
  const previous = new Float64Array(32768);
  let position = 0;
  let base = 0;
  let eof = read(65536) === 0;
  let matchLength = 2;
  let matchStart = 0;
  let work = 0;
  const insert = (at: number): number => {
    const hash = ((output[at]! << 10) ^ (output[at + 1]! << 5) ^ output[at + 2]!) & 32767;
    const candidate = head[hash]!;
    previous[at & 32767] = candidate;
    head[hash] = at;
    return candidate;
  };
  const longest = (candidate: number, best: number, available: number): number => {
    let remaining = best >= good ? chain >>> 2 : chain;
    const limit = Math.max(base, position - 32506);
    const maximum = Math.min(258, available);
    do {
      work++;
      if (output[candidate + best] === output[position + best] &&
          output[candidate + best - 1] === output[position + best - 1] &&
          output[candidate] === output[position] && output[candidate + 1] === output[position + 1]) {
        let count = 2;
        while (count < maximum && output[candidate + count] === output[position + count]) count++;
        if (count > best) {
          best = count;
          matchStart = candidate;
          if (count >= Math.min(nice, available)) break;
        }
      }
      candidate = previous[candidate & 32767]!;
    } while (candidate > limit && --remaining > 0);
    return Math.min(best, available);
  };
  while (true) {
    if (++work >= 32768) {
      await yieldTurn(signal);
      work = 0;
    }
    let available = length() - position;
    while (available < 262) {
      if (position - base >= 65274) base += 32768;
      if (eof) break;
      await yieldTurn(signal);
      eof = read(65536 - (length() - base)) === 0;
      available = length() - position;
    }
    if (available === 0) return;
    const candidate = available >= 3 ? insert(position) : 0;
    if (level <= 3) {
      matchLength = candidate > base && position - candidate <= 32506 ? longest(candidate, 2, available) : 0;
      if (matchLength >= 3) {
        const end = position + matchLength;
        if (matchLength <= lazy && available - matchLength >= 3) {
          while (++position < end) insert(position);
        } else position = end;
      } else position++;
    } else {
      const priorLength = matchLength;
      matchLength = 2;
      if (candidate > base && priorLength < lazy && position - candidate <= 32506) {
        matchLength = longest(candidate, priorLength, available);
        if (matchLength === 3 && position - matchStart > 4096) matchLength = 2;
      }
      if (priorLength >= 3 && matchLength <= priorLength) {
        const end = position + priorLength - 1;
        while (++position < end) {
          if (position <= length() - 3) insert(position);
        }
        matchLength = 2;
      } else position++;
    }
  }
}

// Info-ZIP Unix STORE and DEFLATE first-read sizes after -l halves the buffer.
export async function zipToCrlf(bytes: Uint8Array, store: boolean, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  let text = false;
  for (let index = 0; index < Math.min(bytes.length, store ? 8192 : 32768); index++) {
    const byte = bytes[index]!;
    if (byte <= 6 || byte >= 14 && byte <= 25 || byte >= 28 && byte <= 31) return bytes;
    if (byte >= 32) text = true;
  }
  if (!text) return bytes;
  let size = bytes.length;
  for (let index = 0; index < bytes.length; index++) {
    if (index % 32768 === 0) await yieldTurn(signal);
    if (bytes[index] === 10 && ++size > maxBytes) fail("converted payload byte limit exceeded");
  }
  if (size === bytes.length) return bytes;
  const output = new Uint8Array(size);
  let offset = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (index % 32768 === 0) await yieldTurn(signal);
    const byte = bytes[index]!;
    if (byte === 10) output[offset++] = 13;
    output[offset++] = byte;
  }
  return output;
}
