import { PublicDiagnostic } from "../../../diagnostics.js";
import type { BoundedCodec, BoundedCodecOptions } from "./bounded-codec.js";
import type { RawCodecFactory } from "./native/types.js";
import { profiles } from "./options.js";
import { CompressedDataError } from "./errors.js";

function unavailable(): never { throw new Error("codec attempted an unavailable host operation"); }

const wasi = Object.freeze({
  fd_prestat_get: () => 8,
  fd_prestat_dir_name: unavailable,
  fd_write: unavailable,
  fd_read: unavailable,
  fd_close: unavailable,
  fd_seek: unavailable,
  fd_fdstat_get: unavailable,
  fd_fdstat_set_flags: unavailable,
  fd_filestat_get: unavailable,
  environ_get: unavailable,
  environ_sizes_get: unavailable,
  random_get: unavailable,
  clock_time_get: unavailable,
  proc_exit: unavailable,
});

/** Pure-JS generated codecs have no runtime fetch, native process, or WASM compilation. */
export async function createCodec(
  options: BoundedCodecOptions,
  signal: AbortSignal,
  factory?: RawCodecFactory,
): Promise<BoundedCodec> {
  signal.throwIfAborted();
  const minimumLevel = profiles.find(profile => profile.format === options.format)?.minimumLevel ?? 1;
  if (!Number.isInteger(options.level) || options.level < minimumLevel || options.level > 9) throw new RangeError("invalid codec level");
  if (options.extreme && options.format !== "xz") throw new RangeError("extreme preset requires XZ");
  if (options.zstd) {
    const value = options.zstd;
    if (options.format !== "zstd" || typeof value.check !== "boolean" || ![0, 1, 2].includes(value.literals) || ![0, 1, 2].includes(value.row)
      || !Number.isInteger(value.window) || value.window !== 0 && (value.window < 10 || value.window > 30)
      || !Number.isInteger(value.sizeHint) || value.sizeHint < 0 || value.sizeHint > 0x7fffffff
      || value.streamSize !== undefined && (!Number.isSafeInteger(value.streamSize) || value.streamSize < 0)) throw new RangeError("invalid Zstandard codec parameters");
  }
  for (const memory of [options.xzDecompressMemory, options.xzCompressMemory]) {
    if (memory !== undefined && (options.format !== "xz" || !Number.isSafeInteger(memory) || memory < 0)) throw new RangeError("invalid XZ memory limit");
  }
  if (options.xzNoAdjust !== undefined && (options.format !== "xz" || typeof options.xzNoAdjust !== "boolean")) throw new RangeError("invalid XZ adjustment policy");
  if (options.xzFormat !== undefined && (options.format !== "xz" || !["auto", "xz", "lzma", "raw"].includes(options.xzFormat))) throw new RangeError("invalid XZ format");
  if (options.xzBlockSize !== undefined && (options.format !== "xz" || !Number.isSafeInteger(options.xzBlockSize) || options.xzBlockSize < 0)) throw new RangeError("invalid XZ block size");
  if (options.xzFlushTimeout !== undefined && (options.format !== "xz" || !Number.isSafeInteger(options.xzFlushTimeout) || options.xzFlushTimeout < 0)) throw new RangeError("invalid XZ flush timeout");
  if (options.xzBlockList !== undefined && (options.format !== "xz" || !Array.isArray(options.xzBlockList) || !options.xzBlockList.length || options.xzBlockList.some((size, index) => !Number.isSafeInteger(size) || size < 0 || size === 0 && index !== options.xzBlockList!.length - 1))) throw new RangeError("invalid XZ block list");
  if (options.xzFilters !== undefined && (options.format !== "xz" || !Array.isArray(options.xzFilters) || options.xzFilters.length < 1 || options.xzFilters.length > 4
    || options.xzFilters.some(value => typeof value !== "string" || !value || value.includes("--") || [...value].some(character => character.charCodeAt(0) <= 32)))) throw new RangeError("invalid XZ filters");
  if (!options.decompress && options.xzFlushTimeout && (options.xzFormat === "lzma" || options.xzFilters?.some(filter => !["delta", "lzma2"].includes(filter.split(":")[0]!.split("=")[0]!)))) throw new PublicDiagnostic("filter chain is incompatible with --flush-timeout");
  const filterSpec = options.xzFilters?.join(" ") ?? `${options.level}${options.extreme ? "e" : ""}`;
  const filterBytes = new TextEncoder().encode(filterSpec + "\0");
  if (filterBytes.length > 65536) throw new RangeError("XZ filter options exceed codec buffer");
  const requestedMemory = options.format === "xz" ? (options.decompress ? options.xzDecompressMemory : options.xzCompressMemory) ?? 0 : 0;
  const memoryLimit = requestedMemory;
  if (memoryLimit !== 0 && memoryLimit < 1024) throw new PublicDiagnostic("codec memory limit exceeded");
  if (options.xzCheck !== undefined && (options.format !== "xz" || ![0, 1, 4, 10].includes(options.xzCheck))) throw new RangeError("invalid XZ integrity check");
  if (options.xzIgnoreCheck !== undefined && (options.format !== "xz" || typeof options.xzIgnoreCheck !== "boolean")) throw new RangeError("invalid XZ checksum policy");
  const lzma = options.lzma;
  if (lzma && (options.format !== "xz" || !Number.isInteger(lzma.dictionary) || lzma.dictionary < 0 || lzma.dictionary > 0xffffffff ||
      !Number.isInteger(lzma.properties) || lzma.properties < 0 || lzma.properties >= 225 || lzma.properties % 9 + Math.floor(lzma.properties / 9) % 5 > 4 ||
      typeof lzma.eos !== "boolean" || !Number.isSafeInteger(lzma.size) || lzma.size < 0)) throw new PublicDiagnostic("invalid LZMA properties or dictionary limit exceeded");
  if (!factory) {
    switch (options.format) {
      case "bzip2": factory = (await import("./native/generated/bz2.mjs")).default; break;
      case "xz": factory = (await import("./native/generated/xz.mjs")).default; break;
      case "zstd": factory = (await import("./native/generated/zstd.mjs")).default; break;
    }
  }
  signal.throwIfAborted();
  const module = factory(wasi);
  let closed = false;
  const close = (): void => {
    if (!closed) { closed = true; module.bridge_destroy(); }
  };
  try {
    module._initialize?.();
    const custom = options.format === "xz" && (options.xzFormat === "raw" || options.xzFilters !== undefined);
    if (custom) new Uint8Array(module.memory.buffer, module.bridge_input(), filterBytes.length).set(filterBytes);
    const initialized = custom
      ? module.bridge_create_filters?.(Number(options.decompress), module.bridge_input(), Number(options.xzFormat === "raw"), Number(options.xzFormat === "lzma"), options.xzCheck ?? 4, memoryLimit >>> 0, Math.floor(memoryLimit / 0x100000000), Number(options.xzNoAdjust === true), Number(options.xzIgnoreCheck === true))
      : lzma
      ? module.bridge_create_lzma?.(Number(options.decompress), options.level, memoryLimit >>> 0, lzma!.dictionary, lzma!.properties, Number(lzma!.eos), lzma!.size >>> 0, Math.floor(lzma!.size / 0x100000000), Math.floor(memoryLimit / 0x100000000))
      : module.bridge_create(Number(options.decompress), options.extreme ? options.level | 0x80000000 : options.level, memoryLimit >>> 0, 30, options.format === "xz" ? options.xzCheck ?? 4 : Number(options.small === true), Number(options.xzIgnoreCheck === true), Number(options.xzFormat === "lzma"), Math.floor(memoryLimit / 0x100000000), Number(options.xzNoAdjust === true));
    signal.throwIfAborted();
    if (initialized !== 0) throw new PublicDiagnostic("codec initialization failed or memory limit exceeded");
    if (options.format === "xz" && !options.decompress && !lzma) {
      const adjusted = module.bridge_xz_adjusted_dictionary?.() ?? 0;
      if (adjusted) await options.onXzAdjust?.(adjusted);
      signal.throwIfAborted();
    }
    if (options.zstd) {
      const value = options.zstd;
      const size = value.streamSize ?? 0;
      if (module.bridge_zstd_config?.(Number(value.check), value.literals, value.row, value.window, size >>> 0, Math.floor(size / 0x100000000), Number(value.streamSize !== undefined), value.sizeHint) !== 0) throw new PublicDiagnostic("unsupported Zstandard codec parameters");
    }
    const inputPointer = module.bridge_input();
    const outputPointer = module.bridge_output();
    return {
      step(input, output, finish, flush) {
        signal.throwIfAborted();
        if (closed) throw new Error("codec is closed");
        if (input.length > 65536 || output.length < 1 || output.length > 65536) throw new RangeError("invalid codec buffer size");
        new Uint8Array(module.memory.buffer, inputPointer, input.length).set(input);
        const status = module.bridge_step(inputPointer, input.length, outputPointer, output.length, flush === "block" ? 2 : flush === "sync" ? 3 : Number(finish));
        signal.throwIfAborted();
        if (status === -4) throw new CompressedDataError("unexpected end of file");
        if (status === -2 || status === -3) throw new CompressedDataError("invalid compressed data or codec memory limit exceeded");
        if (status !== 1 && status !== 2 && status !== 3 && status !== 4) throw new Error(`invalid codec status ${status}`);
        const consumed = module.bridge_consumed();
        const produced = module.bridge_produced();
        if (!Number.isSafeInteger(consumed) || consumed < 0 || consumed > input.length ||
            !Number.isSafeInteger(produced) || produced < 0 || produced > output.length) throw new Error("invalid codec progress");
        output.set(new Uint8Array(module.memory.buffer, outputPointer, produced));
        return { consumed, produced, status: status === 1 ? "end" : status === 4 ? "flushed" : status === 3 ? "output" : "input" };
      },
      close,
    };
  } catch (error) {
    try { close(); } catch { /* Preserve the acquisition failure. */ }
    throw error;
  }
}
