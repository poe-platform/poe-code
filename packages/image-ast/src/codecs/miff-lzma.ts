import createXz from "safe-bash-compression-engine/native/generated/xz";

export interface MiffRead { offset: number; length: number }

/** A MIFF frame contains one XZ stream split into big-endian length-prefixed packets. */
export function* miffLzma(offset: number, size: number, pixelBytes: number, expected: number): Generator<MiffRead | Uint8Array, number, Uint8Array> {
    const unavailable = (): never => { throw new Error("LZMA attempted a host operation"); };
    const module = createXz({
        fd_prestat_get: () => 8, fd_prestat_dir_name: unavailable,
        fd_fdstat_get: unavailable, fd_read: unavailable, fd_write: unavailable,
        proc_exit: unavailable, fd_seek: unavailable, fd_close: unavailable
    });
    try {
        module._initialize?.();
        // Bound dictionary allocation independently of the declared image dimensions.
        if (module.bridge_create(1, 0, 128 * 1024 * 1024, 30) !== 0) throw new Error("MIFF LZMA initialization failed");
        const output = new Uint8Array(1024 * pixelBytes);
        let buffered = 0, total = 0, remaining = 0, drain = false;
        let input: Uint8Array = new Uint8Array(), consumed = 0;
        for (;;) {
            if (consumed === input.length && !drain) {
                if (!remaining) {
                    if (size - offset < 4) throw new Error("Truncated MIFF LZMA packet");
                    const header = yield { offset, length: 4 };
                    if (header.length !== 4) throw new Error("Truncated MIFF LZMA packet");
                    remaining = new DataView(header.buffer, header.byteOffset, 4).getUint32(0);
                    offset += 4;
                    if (!remaining || remaining > size - offset) throw new Error("Invalid MIFF LZMA packet length");
                }
                const length = Math.min(8192, remaining);
                input = yield { offset, length };
                if (input.length !== length) throw new Error("Truncated MIFF LZMA packet");
                // Source reads can borrow memory; the next yield may overwrite it.
                input = input.slice();
                offset += length; remaining -= length; consumed = 0;
            }
            const inputPointer = module.bridge_input(), outputPointer = module.bridge_output();
            new Uint8Array(module.memory.buffer, inputPointer, input.length - consumed).set(input.subarray(consumed));
            const status = module.bridge_step(inputPointer, input.length - consumed, outputPointer, output.length - buffered, 0);
            if (status !== 1 && status !== 2 && status !== 3) throw new Error("Invalid MIFF LZMA stream");
            const read = module.bridge_consumed(), written = module.bridge_produced();
            consumed += read; total += written;
            if (total > expected) throw new Error("MIFF LZMA raster exceeds dimensions");
            output.set(new Uint8Array(module.memory.buffer, outputPointer, written), buffered);
            buffered += written;
            if (status === 1 && (total !== expected || remaining || consumed !== input.length)) throw new Error("Invalid MIFF LZMA raster length");
            if (buffered === output.length || status === 1 && buffered) {
                yield output.slice(0, buffered);
                buffered = 0;
            }
            if (status === 1) return offset;
            drain = status === 3;
            if (!read && !written && (consumed < input.length || drain)) throw new Error("MIFF LZMA decoder made no progress");
        }
    } finally { module.bridge_destroy(); }
}
