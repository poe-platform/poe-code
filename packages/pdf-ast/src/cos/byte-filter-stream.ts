import { readBytes } from "@poe-code/safe-fs/contracts";
import { PdfError } from "../errors.js";
import type { PdfFilterDecodeParms } from "./filters.js";
import type { PdfInflateOptions } from "./flate-stream.js";

type ByteCodes = { readonly done: boolean; push(bytes: Uint8Array, final?: boolean): Generator<number> };

function lzw(earlyChange: number): ByteCodes {
  // Prefix links replace an array of growing byte strings. The PDF dictionary
  // has at most 4096 entries; expansion needs one equally bounded reverse stack.
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  let next = 258, width = 9, previous = -1, buffer = 0, bits = 0;
  let done = false;
  return {
    get done() { return done; },
    *push(bytes) {
      for (const byte of bytes) {
        if (done) return;
        buffer = (buffer << 8) | byte; bits += 8;
        while (bits >= width) {
          bits -= width;
          const code = (buffer >>> bits) & ((1 << width) - 1);
          if (code === 257) { done = true; return; }
          if (code === 256) { next = 258; width = 9; previous = -1; continue; }
          const special = code === next && previous >= 0;
          if (code >= next && !special) throw new PdfError("E_CAPABILITY", "Invalid LZW code in stream");
          let cursor = special ? previous : code;
          let length = 0;
          while (cursor >= 258) {
            stack[length++] = suffix[cursor]!;
            cursor = prefix[cursor]!;
          }
          if (cursor >= 256) throw new PdfError("E_CAPABILITY", "Invalid LZW code in stream");
          stack[length++] = cursor;
          for (let i = length - 1; i >= 0; i--) yield stack[i]!;
          if (special) yield cursor;
          if (previous >= 0 && next < 4096) {
            prefix[next] = previous; suffix[next++] = cursor;
            if (next === (1 << width) - earlyChange && width < 12) width++;
          }
          previous = code;
        }
      }
    },
  };
}

function textCodes(name: "hex" | "ascii85" | "runlength"): ByteCodes {
  let done = false;
  let nibble = -1;
  let group = 0, digits = 0;
  let remaining = 0, repeat = false;
  return {
    get done() { return done; },
    *push(bytes, final = false) {
      for (const byte of bytes) {
        if (done) break;
        if (name === "runlength") {
          if (remaining > 0) {
            if (repeat) { while (remaining-- > 0) yield byte; repeat = false; remaining = 0; }
            else { yield byte; remaining--; }
          } else if (byte === 128) done = true;
          else { remaining = byte < 128 ? byte + 1 : 257 - byte; repeat = byte > 128; }
          continue;
        }
        if (byte === (name === "hex" ? 62 : 126)) { done = true; break; }
        if (byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32) continue;
        if (name === "hex") {
          const value = byte >= 48 && byte <= 57 ? byte - 48 : byte >= 65 && byte <= 70 ? byte - 55 : byte >= 97 && byte <= 102 ? byte - 87 : -1;
          if (value < 0) throw new PdfError("E_CAPABILITY", "Invalid byte in ASCIIHexDecode stream");
          if (nibble < 0) nibble = value;
          else { yield (nibble << 4) | value; nibble = -1; }
        } else {
          if (byte === 122) {
            if (digits !== 0) throw new PdfError("E_CAPABILITY", "Invalid 'z' inside ASCII85 group");
            yield 0; yield 0; yield 0; yield 0;
          } else {
            if (byte < 33 || byte > 117) throw new PdfError("E_CAPABILITY", "Invalid ASCII85 character");
            group = group * 85 + byte - 33; digits++;
            if (digits === 5) {
              for (let shift = 24; shift >= 0; shift -= 8) yield (group >>> shift) & 255;
              group = 0; digits = 0;
            }
          }
        }
      }
      if (final) {
        if (name === "hex" && nibble >= 0) { yield nibble << 4; nibble = -1; }
        if (name === "ascii85") {
          if (digits === 1) throw new PdfError("E_CAPABILITY", "Invalid trailing ASCII85 group");
          if (digits > 1) {
            const count = digits - 1;
            while (digits++ < 5) group = group * 85 + 84;
            for (let i = 0; i < count; i++) yield (group >>> (24 - i * 8)) & 255;
            group = 0; digits = 0;
          }
        }
        if (name === "runlength" && repeat) { while (remaining-- > 0) yield 0; remaining = 0; repeat = false; }
        done = true;
      }
    },
  };
}

/** Stateful byte codecs with bounded dictionaries and owned output chunks. */
export async function* decodePdfByteFilter(input: AsyncIterable<Uint8Array>, name: "hex" | "ascii85" | "runlength" | "lzw", parms: PdfFilterDecodeParms | undefined, options: PdfInflateOptions = {}): AsyncGenerator<Uint8Array> {
  const chunkBytes = options.chunkBytes ?? 64 * 1024;
  const maximum = options.maxDecodedBytes ?? Infinity;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError("Invalid chunkBytes");
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 0)) throw new RangeError("Invalid maxDecodedBytes");
  options.signal?.throwIfAborted();
  const codec = name === "lzw" ? lzw(parms?.EarlyChange ?? 1) : textCodes(name);
  let output: Uint8Array | undefined;
  let used = 0, total = 0, turns = 0;
  function* consume(bytes: Uint8Array, final = false) {
    for (const byte of codec.push(bytes, final)) {
      if (total >= Math.min(maximum, Number.MAX_SAFE_INTEGER)) throw new PdfError("E_LIMIT", "PDF filter decoded byte limit exceeded");
      output ??= new Uint8Array(Math.min(chunkBytes, maximum - total));
      output[used++] = byte; total++;
      if (used === output.length) { const ready = output; output = undefined; used = 0; yield ready; }
    }
  }
  for await (const chunk of readBytes(input, options.signal)) {
    for (const decoded of consume(chunk)) {
      options.signal?.throwIfAborted(); yield decoded;
      if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (codec.done) break;
    if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  for (const decoded of consume(new Uint8Array(0), true)) { options.signal?.throwIfAborted(); yield decoded; }
  if (used) { options.signal?.throwIfAborted(); yield output!.slice(0, used); }
}
