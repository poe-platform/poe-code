import { createByteCodec } from "@poe-code/compression";
import type { OutputEncodeOptions } from "../ast.js";

/** TIFF FillOrder reverses bits within encoded bytes, before decompression. */
export const tiffReversedBytes = Uint8Array.from({ length: 256 }, (_, byte) => {
  byte = ((byte & 0x55) << 1) | ((byte >>> 1) & 0x55);
  byte = ((byte & 0x33) << 2) | ((byte >>> 2) & 0x33);
  return (byte << 4) | (byte >>> 4);
});

type TiffCompressionOptions = Pick<OutputEncodeOptions, "tiffCompression" | "tiffPredictor" | "tiffIntegerDepth" | "tiffFloatDepth" | "tiffEndian">;

export function tiffPredictor(options?: TiffCompressionOptions): 1 | 2 | undefined {
  if (options?.tiffCompression !== "lzw" && options?.tiffCompression !== "deflate") return undefined;
  if (options.tiffFloatDepth) return undefined;
  return options.tiffPredictor ?? (options.tiffIntegerDepth === 32 ? 1 : 2);
}

export function createTiffCompressor(options: TiffCompressionOptions | undefined, columns: number, channels: number) {
  const method = options?.tiffCompression, sampleBytes = (options?.tiffFloatDepth ?? options?.tiffIntegerDepth ?? 8) / 8;
  const rowBytes = columns * channels * sampleBytes, little = options?.tiffEndian !== "msb";
  const previous = tiffPredictor(options) === 2 ? new Uint32Array(channels) : undefined;
  let sample = 0;
  const deflate = method === "deflate" ? createByteCodec({ direction: "encode", format: "zlib", chunkSize: 4096 }) : undefined;
  const dictionary = new Map<number, number>();
  let next = 258, width = 9, prefix = -1, bits = 0, buffer = 0, started = false, column = 0;
  return {
    *push(input: Uint8Array, final = false): Generator<Uint8Array> {
      if (previous) {
        const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
        for (let at = 0; at < input.length; at += sampleBytes) {
          const channel = sample % channels;
          const value = sampleBytes === 1 ? input[at]! : sampleBytes === 2 ? view.getUint16(at, little) : view.getUint32(at, little);
          const difference = value - (sample < channels ? 0 : previous[channel]!);
          previous[channel] = value;
          if (sampleBytes === 1) input[at] = difference;
          else if (sampleBytes === 2) view.setUint16(at, difference, little);
          else view.setUint32(at, difference, little);
          if (++sample === columns * channels) sample = 0;
        }
      }
      if (deflate) { yield* deflate.push(input, final); return; }
      if (method !== "lzw" && method !== "packbits") { if (input.length) yield input; return; }
      const output: number[] = [];
      const emit = (code: number) => {
        buffer = (buffer << width) | code; bits += width;
        while (bits >= 8) { bits -= 8; output.push((buffer >>> bits) & 255); }
      };
      if (method === "lzw") {
        if (!started) { emit(256); started = true; }
        for (const byte of input) {
          if (prefix < 0) { prefix = byte; continue; }
          const key = prefix * 256 + byte, found = dictionary.get(key);
          if (found !== undefined) { prefix = found; continue; }
          emit(prefix);
          dictionary.set(key, next++);
          // The encoder's dictionary is one entry ahead of the decoder.
          if (next === 512 || next === 1024 || next === 2048) width++;
          if (next === 4096) { emit(256); dictionary.clear(); next = 258; width = 9; }
          prefix = byte;
        }
        if (final) {
          if (prefix >= 0) emit(prefix);
          if (next === 511 || next === 1023 || next === 2047) width++;
          emit(257);
          if (bits) output.push((buffer << (8 - bits)) & 255);
        }
      } else {
        for (let at = 0; at < input.length;) {
          const end = Math.min(input.length, at + rowBytes - column);
          while (at < end) {
            let run = 1;
            while (run < 128 && at + run < end && input[at + run] === input[at]) run++;
            if (run >= 3) { output.push(257 - run, input[at]!); at += run; column += run; }
            else {
              const start = at++;
              while (at < end && at - start < 128) {
                if (at + 2 < end && input[at] === input[at + 1] && input[at] === input[at + 2]) break;
                at++;
              }
              output.push(at - start - 1, ...input.subarray(start, at)); column += at - start;
            }
          }
          if (column === rowBytes) column = 0;
        }
      }
      if (output.length) yield Uint8Array.from(output);
    },
    close() { deflate?.close(); dictionary.clear(); }
  };
}
