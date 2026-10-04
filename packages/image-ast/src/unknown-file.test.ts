import { expect, it } from "vitest";
import sharp from "./index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

for (const operation of ["metadata", "stats", "file", "stream", "composite", "join"] as const)
for (const failureMode of ["none", "read", "cancel", "close"] as const)
it(`rejects unknown file resources without buffering: ${operation}/${failureMode}`, async () => {
    const fs = new MemoryFileSystem(), size = 1048593, controller = new AbortController(), failure = new Error("unknown source " + failureMode);
    await fs.writeFile("/input", Uint8Array.of(0)); await fs.writeFile("/output.png", Uint8Array.of(7));
    await fs.writeFile("/base", await sharp({ create: { width: 7, height: 9, channels: 4, background: "red" } }).png().toBuffer());
    let opened = 0, closed = 0, readBytes = 0;
    const stat = async () => ({ ...await fs.stat("/input"), size });
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
            if (args[0] !== "/input") return fs.openReadFile(...args);
            opened++;
            return { stat, async read(position: number, length: number) {
                expect(length).toBeLessThanOrEqual(16384); readBytes += length;
                if (position >= 16384) { if (failureMode === "read") throw failure; if (failureMode === "cancel") controller.abort(failure); }
                return new Uint8Array(length);
            }, async close() { closed++; if (failureMode === "close") throw failure; } };
        };
        if (key === "stat" || key === "lstat") return async (...args: Parameters<typeof fs.stat>) => args[0] === "/input" ? stat() : fs[key](...args);
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file image fallback forbidden"); };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const image = sharp(operation === "composite" || operation === "join" ? "/base" : "/input", { filesystem, signal: controller.signal }).png();
    const run = async () => {
        if (operation === "metadata") return image.metadata();
        if (operation === "stats") return image.stats();
        if (operation === "stream") { const reader = image.readable.getReader(); try { return await reader.read(); } finally { reader.releaseLock(); } }
        if (operation === "composite") image.composite([{ input: "/input" }]);
        if (operation === "join") image.joinChannel("/input");
        return image.toFile("/output.png");
    };
    if (failureMode === "none") await expect(run()).rejects.toThrow("Input buffer contains unsupported image format");
    else await expect(run()).rejects.toBe(failure);
    await image.dispose();
    expect(closed).toBe(opened); expect(opened).toBeGreaterThan(0);
    expect(readBytes).toBeLessThan(size + 16384);
    expect(await fs.readFile("/output.png")).toEqual(Uint8Array.of(7));
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["base", "input", "output.png"]);
});
