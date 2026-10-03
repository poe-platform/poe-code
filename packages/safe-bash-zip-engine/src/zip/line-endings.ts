import { createBytePipe, readBytes, type ByteSource } from "safe-bash-contracts";
import { CodecReader } from "safe-bash-compression-engine/codec";
import { yieldTurn } from "safe-bash-contracts/yield";
import { fail } from "safe-bash-io-engine/commands/archive/internal";

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
    await zipDeflateReads(index => output[index], read, () => length, level, signal);
  }
  return output.slice(0, length);
}

// Only the Unix Info-ZIP internal compressor's input schedule is modeled here;
// the existing codec still encodes the resulting bytes. Refill capacity depends
// on converted bytes, sliding, and fast/lazy match advancement, not I/O chunks.
async function zipDeflateReads(at: (index: number) => number | undefined, read: (size: number) => number | Promise<number>, length: () => number, level: number, signal: AbortSignal): Promise<void> {
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
  let eof = await read(65536) === 0;
  let matchLength = 2;
  let matchStart = 0;
  let work = 0;
  const insert = (position: number): number => {
    const hash = ((at(position)! << 10) ^ (at(position + 1)! << 5) ^ at(position + 2)!) & 32767;
    const candidate = head[hash]!;
    previous[position & 32767] = candidate;
    head[hash] = position;
    return candidate;
  };
  const longest = (candidate: number, best: number, available: number): number => {
    let remaining = best >= good ? chain >>> 2 : chain;
    const limit = Math.max(base, position - 32506);
    const maximum = Math.min(258, available);
    do {
      work++;
      if (at(candidate + best) === at(position + best) &&
          at(candidate + best - 1) === at(position + best - 1) &&
          at(candidate) === at(position) && at(candidate + 1) === at(position + 1)) {
        let count = 2;
        while (count < maximum && at(candidate + count) === at(position + count)) count++;
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
      eof = await read(65536 - (length() - base)) === 0;
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

/** Preserve native conversion read schedules with a fixed history ring and one
 * backpressured output chunk; producer chunk boundaries do not affect results. */
export async function* zipLineEndingStream(source: ByteSource, from: boolean, store: boolean, maximum: number, signal: AbortSignal, level = 6, profile?: (converted: boolean) => void): ByteSource {
  const controller = new AbortController();
  const active = AbortSignal.any([signal, controller.signal]);
  const pipe = createBytePipe({ highWaterMark: 65536, signal: active });
  const original = new CodecReader(source, active);
  let reader = original;
  const take = async (size: number): Promise<Uint8Array> => {
    const result = new Uint8Array(size);
    let length = 0;
    while (length < size) {
      const chunk = await reader.chunk();
      if (!chunk) break;
      const used = Math.min(size - length, chunk.length);
      result.set(chunk.subarray(0, used), length); length += used;
      if (used < chunk.length) reader.restore(chunk.subarray(used));
    }
    return result.subarray(0, length);
  };
  const producer = (async () => {
    let written = 0;
    const emit = async (bytes: Uint8Array) => {
      if (bytes.length > maximum - written) fail("converted payload byte limit exceeded");
      written += bytes.length;
      for (let offset = 0; offset < bytes.length; offset += 65536) await pipe.writable.write(bytes.subarray(offset, offset + 65536));
    };
    try {
      const window = from ? store ? 16383 : 65535 : store ? 8192 : 32768;
      const prefix = await take(window);
      let textual = false, binary = false;
      for (const byte of prefix) {
        if (byte <= 6 || byte >= 14 && byte <= 25 || byte >= 28 && byte <= 31) binary = true;
        if (byte >= 32) textual = true;
      }
      const convert = textual && !binary;
      profile?.(convert);
      reader = new CodecReader((async function* () {
        yield prefix;
        for (;;) { const chunk = await original.chunk(); if (!chunk) break; yield chunk; }
      })(), active);
      if (!convert) {
        for (;;) { const chunk = await reader.chunk(); if (!chunk) break; await emit(chunk); }
      } else if (!from) {
        for (;;) {
          const chunk = await take(32768);
          if (!chunk.length) break;
          const output = new Uint8Array(chunk.length * 2);
          let size = 0;
          for (const byte of chunk) { if (byte === 10) output[size++] = 13; output[size++] = byte; }
          await emit(output.subarray(0, size));
        }
      } else {
        const ring = new Uint8Array(65536);
        let length = 0;
        const read = async (size: number) => {
          const chunk = await take(size - 1);
          if (!chunk.length) return 0;
          const output = new Uint8Array(chunk.length + 1);
          let count = 0;
          for (let index = 0; index < chunk.length; index++) {
            const byte = chunk[index]!;
            if (byte !== 13 || index + 1 < chunk.length && chunk[index + 1] !== 10) output[count++] = byte;
          }
          if (!count) {
            const extra = await take(1);
            output[count++] = extra.length ? extra[0]! : chunk[chunk.length - 1]!;
          } else if (output[count - 1] === 26) count--;
          for (let index = 0; index < count; index++) ring[(length + index) % ring.length] = output[index]!;
          length += count;
          await emit(output.subarray(0, count));
          return count;
        };
        if (store || prefix.length < window) {
          while (await read(window + 1)) await yieldTurn(active);
        } else await zipDeflateReads(index => ring[index % ring.length], read, () => length, level, active);
      }
      await pipe.close();
    } catch (error) { await pipe.abort(error); }
    finally { await reader.close(); if (reader !== original) await original.close(); }
  })();
  try { yield* readBytes(pipe.readable, active); }
  finally {
    controller.abort(new Error("ZIP conversion closed"));
    await pipe.abort();
    await producer;
  }
}
