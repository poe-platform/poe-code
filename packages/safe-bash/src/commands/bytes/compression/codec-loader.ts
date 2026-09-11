import { PublicDiagnostic } from "../../../diagnostics.js";
import type { BoundedCodec, BoundedCodecOptions } from "./bounded-codec.js";
import type { RawCodecFactory } from "./native/types.js";

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
  if (!Number.isInteger(options.level) || options.level < 1 || options.level > 9) throw new RangeError("invalid codec level");
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
    const initialized = module.bridge_create(Number(options.decompress), options.level, 64 * 1024 * 1024, 23);
    signal.throwIfAborted();
    if (initialized !== 0) throw new PublicDiagnostic("codec initialization failed or memory limit exceeded");
    const inputPointer = module.bridge_input();
    const outputPointer = module.bridge_output();
    return {
      step(input, output, finish) {
        signal.throwIfAborted();
        if (closed) throw new Error("codec is closed");
        if (input.length > 65536 || output.length < 1 || output.length > 65536) throw new RangeError("invalid codec buffer size");
        new Uint8Array(module.memory.buffer, inputPointer, input.length).set(input);
        const status = module.bridge_step(inputPointer, input.length, outputPointer, output.length, Number(finish));
        signal.throwIfAborted();
        if (status === -4) throw new PublicDiagnostic("unexpected end of file");
        if (status === -2 || status === -3) throw new PublicDiagnostic("invalid compressed data or codec memory limit exceeded");
        if (status !== 1 && status !== 2 && status !== 3) throw new Error(`invalid codec status ${status}`);
        const consumed = module.bridge_consumed();
        const produced = module.bridge_produced();
        if (!Number.isSafeInteger(consumed) || consumed < 0 || consumed > input.length ||
            !Number.isSafeInteger(produced) || produced < 0 || produced > output.length) throw new Error("invalid codec progress");
        output.set(new Uint8Array(module.memory.buffer, outputPointer, produced));
        return { consumed, produced, status: status === 1 ? "end" : status === 3 ? "output" : "input" };
      },
      close,
    };
  } catch (error) {
    try { close(); } catch { /* Preserve the acquisition failure. */ }
    throw error;
  }
}
