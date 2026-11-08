import { expect, it } from "vitest";
import { FsError, type FsOptions } from "@poe-code/safe-fs/contracts";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { withImageInputs } from "./image-input.js";
it("serves cross-page reads from caller-backed stdin without recharging repeated operands", async () => {
    const filesystem = new MemoryFileSystem(), size = 2 * 1024 * 1024 + 19;
    let charged = 0;
    const stdin = (async function* () {
        const reused = new Uint8Array(4096);
        for (let offset = 0; offset < size; offset += 4096) {
            const length = Math.min(4096, size - offset);
            for (let i = 0; i < length; i++)
                reused[i] = (offset + i) % 251;
            yield reused.subarray(0, length);
        }
    })();
    await withImageInputs({ filesystem, cwd: "/", stdin, inputBudget: { check(total) { charged = total; } } }, undefined, new AbortController().signal, async (read) => {
        for (let repeat = 0; repeat < 2; repeat++)
            await read("-", async (source) => { expect(source.size).toBe(size); const bytes = await source.read(16380, 65536); expect(bytes).toEqual(Uint8Array.from({ length: 65536 }, (_, i) => (16380 + i) % 251)); });
    });
    expect(charged).toBe(size);
    expect(await filesystem.readdir("/")).toEqual([]);
});
it.each([false, true])("spools streaming-only files into caller backing (retained acquisition refused=%s)", async (refused) => {
    const fs = new MemoryFileSystem(), size = 2 * 1024 * 1024 + 19;
    let charged = 0, closed = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "capabilitiesFor")
                return async (path: string) => ({ ...fs.capabilities, retainedRead: path === "/input" ? refused : true });
            if (key === "openReadFile")
                return async (path: string, options?: FsOptions) => {
                    if (path === "/input")
                        throw new FsError("ENOTSUP");
                    return fs.openReadFile(path, options);
                };
            if (key === "readFile")
                return () => { throw new Error("whole-file read forbidden"); };
            if (key === "readStream")
                return async function* (path: string) {
                    expect(path).toBe("/input");
                    const chunk = new Uint8Array(4096);
                    try {
                        for (let offset = 0; offset < size; offset += chunk.length) {
                            const length = Math.min(chunk.length, size - offset);
                            for (let i = 0; i < length; i++)
                                chunk[i] = (offset + i) % 251;
                            yield chunk.subarray(0, length);
                        }
                    }
                    finally {
                        closed++;
                    }
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    await withImageInputs({ filesystem, cwd: "/", inputBudget: { check(total) { charged = total; } } }, undefined, new AbortController().signal, async (read) => {
        await read("input", async (source) => {
            expect(source.size).toBe(size);
            expect(await source.read(16380, 65536)).toEqual(Uint8Array.from({ length: 65536 }, (_, i) => (16380 + i) % 251));
        });
    });
    expect(charged).toBe(size);
    expect(closed).toBe(1);
    expect(await fs.readdir("/")).toEqual([]);
});
it.each(["budget", "abort", "source", "consumer"] as const)("cleans streamed input backing after %s failure", async (mode) => {
    const fs = new MemoryFileSystem(), controller = new AbortController();
    const reason = new Error(mode);
    let closed = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "capabilitiesFor")
                return async (path: string) => ({ ...fs.capabilities, retainedRead: path !== "/input" });
            if (key === "readFile")
                return () => { throw new Error("whole-file read forbidden"); };
            if (key === "readStream")
                return async function* () {
                    try {
                        for (let i = 0; i < 300; i++) {
                            if (i === 280) {
                                if (mode === "abort")
                                    controller.abort(reason);
                                if (mode === "source")
                                    throw reason;
                            }
                            yield new Uint8Array(4096);
                        }
                    }
                    finally {
                        closed++;
                    }
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    await expect(withImageInputs({ filesystem, cwd: "/", inputBudget: { check(total) {
                if (mode === "budget" && total > 1100000)
                    throw reason;
            } } }, undefined, controller.signal, read => read("input", async () => {
        if (mode === "consumer")
            throw reason;
        throw new Error("consumer must not run");
    }))).rejects.toBe(reason);
    expect(closed).toBe(1);
    expect(await fs.readdir("/")).toEqual([]);
});
it.each(["unavailable", "refused", "partial"] as const)("preserves streaming capability admission: %s", async (mode) => {
    const fs = new MemoryFileSystem(), reason = new FsError("ENOTSUP");
    let buffered = 0, closed = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "capabilitiesFor")
                return async (path: string) => ({ ...fs.capabilities, ...(path === "/input" ? { retainedRead: false, streamingRead: mode !== "unavailable" } : {}) });
            if (key === "readFile")
                return async () => { buffered++; return new Uint8Array([7]); };
            if (key === "readStream")
                return async function* () {
                    try {
                        if (mode === "unavailable")
                            throw new Error("unsupported stream selected");
                        if (mode === "partial")
                            yield new Uint8Array([3]);
                        throw reason;
                    }
                    finally {
                        closed++;
                    }
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    const result = withImageInputs({ filesystem, cwd: "/" }, undefined, new AbortController().signal, read => read("input", source => source.read(0, source.size)));
    if (mode === "partial")
        await expect(result).rejects.toBe(reason);
    else
        await expect(result).resolves.toEqual(new Uint8Array([7]));
    expect(buffered).toBe(mode === "partial" ? 0 : 1);
    expect(closed).toBe(mode === "unavailable" ? 0 : 1);
    expect(await fs.readdir("/")).toEqual([]);
});
for (const route of ["retained", "stream", "buffer"] as const) {
    it.each(["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"] as const)(`preserves consumer %s errors after ${route} input acquisition`, async (code) => {
        const fs = new MemoryFileSystem(), reason = new FsError(code);
        await fs.writeFile("/input", new Uint8Array([1]));
        const filesystem = new Proxy(fs, { get(target, key) {
                if (key === "capabilitiesFor")
                    return async (path: string) => ({ ...fs.capabilities, ...(path === "/input" ? { retainedRead: route === "retained", streamingRead: route !== "buffer" } : {}) });
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
            } });
        await expect(withImageInputs({ filesystem, cwd: "/" }, undefined, new AbortController().signal, read => read("input", async () => { throw reason; }))).rejects.toBe(reason);
        expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input"]);
    });
}
it("preserves missing-style errors after a stream has emitted input", async () => {
    const fs = new MemoryFileSystem(), reason = new FsError("EACCES");
    const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "capabilitiesFor")
                return async () => ({ ...fs.capabilities, retainedRead: false });
            if (key === "readStream")
                return async function* () { yield new Uint8Array([1]); throw reason; };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    await expect(withImageInputs({ filesystem, cwd: "/" }, undefined, new AbortController().signal, read => read("input", async () => 1))).rejects.toBe(reason);
    expect(await fs.readdir("/")).toEqual([]);
});
it("preserves missing-style retained cleanup failures", async () => {
    const fs = new MemoryFileSystem(), reason = new FsError("ENOENT");
    await fs.writeFile("/input", new Uint8Array([1]));
    const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "openReadFile")
                return async (...args: Parameters<typeof fs.openReadFile>) => {
                    const handle = await fs.openReadFile(...args);
                    return { stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() { await handle.close(); throw reason; } };
                };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    await expect(withImageInputs({ filesystem, cwd: "/" }, undefined, new AbortController().signal, read => read("input", async () => 1))).rejects.toBe(reason);
});
