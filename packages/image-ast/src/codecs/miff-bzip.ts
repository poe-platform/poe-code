import createBzip from "safe-bash-compression-engine/native/generated/bz2";

/** One bounded BZip stream per MIFF frame, shared by input and output paths. */
export function createMiffBzip(chunkSize: number, decompress = false) {
    const unavailable = (): never => { throw new Error("BZip attempted a host operation"); };
    let module: ReturnType<typeof createBzip> | undefined = createBzip({
        fd_prestat_get: () => 8, fd_prestat_dir_name: unavailable,
        fd_fdstat_get: unavailable, fd_read: unavailable, fd_write: unavailable,
        proc_exit: unavailable, fd_seek: unavailable, fd_close: unavailable
    });
    const close = (): void => { module?.bridge_destroy(); module = undefined; };
    try {
        module._initialize?.();
        if (module.bridge_create(Number(decompress), 9, 0, 30, 0, 0, 0, 0, 0) !== 0) throw new Error("BZip initialization failed");
    } catch (error) { close(); throw error; }
    let ended = false;
    return {
        close,
        get ended() { return ended; },
        *push(input: Uint8Array, final: boolean): Generator<Uint8Array> {
            if (!module) throw new Error("BZip stream is closed");
            if (ended) throw new Error("BZip stream has ended");
            let offset = 0;
            for (;;) {
                const size = Math.min(65536, input.length - offset);
                const inputPointer = module.bridge_input(), outputPointer = module.bridge_output();
                new Uint8Array(module.memory.buffer, inputPointer, size).set(input.subarray(offset, offset + size));
                const status = module.bridge_step(inputPointer, size, outputPointer, chunkSize, Number(final && offset + size === input.length));
                if (status !== 1 && status !== 2 && status !== 3) throw new Error(`BZip codec failed: ${status}`);
                const consumed = module.bridge_consumed(), produced = module.bridge_produced();
                offset += consumed;
                if (status === 1) {
                    ended = true;
                    if (decompress && offset !== input.length) throw new Error("Trailing MIFF BZip data");
                }
                if (produced) yield new Uint8Array(module.memory.buffer, outputPointer, produced).slice();
                if (status === 1 || !final && offset === input.length && status === 2) return;
                if (!consumed && !produced) throw new Error("BZip codec made no progress");
            }
        }
    };
}
