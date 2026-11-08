import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runCompareCli, runIdentifyCli, runCompositeCli, runMogrifyCli } from "./index.js";

for (const entry of ["convert", "compare", "identify", "identify-verbose", "composite", "mogrify"] as const)
for (const failureMode of ["none", "read", "cancel"] as const)
it(`rejects large unknown images with bounded memory via ${entry}, failure=${failureMode}`, async () => {
    const runner = entry === "compare" ? runCompareCli : entry.startsWith("identify") ? runIdentifyCli : entry === "composite" ? runCompositeCli : entry === "mogrify" ? runMogrifyCli : runConvertCli;
    const args = entry === "compare" || entry === "composite" ? ["input", "input", "out.png"] : entry === "identify-verbose" ? ["-verbose", "input"] : entry === "identify" || entry === "mogrify" ? ["input"] : ["input", "out.png"];
    const expected = await runner(args, new Map([["input", Uint8Array.of(0)]]));
    expect(expected.exitCode).not.toBe(0);
    const fs = new MemoryFileSystem(), Native = Uint8Array, size = 1048593, controller = new AbortController(), failure = new Error("late malformed read failure");
    await fs.writeFile("/input", Native.of(0));
    let opened = 0, closed = 0, maxAllocation = 0, readBytes = 0;
    const stat = async () => ({ ...await fs.stat("/input"), size });
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "openReadFile") return async () => { opened++; return { stat, async read(position: number, length: number) { readBytes += length; if (position >= 16384 && failureMode !== "none") { if (failureMode === "cancel") controller.abort(failure); else throw failure; } return new Native(length); }, async close() { closed++; } }; };
        if (key === "stat" || key === "lstat") return async (...args: Parameters<typeof fs.stat>) => args[0] === "/input" ? stat() : fs[key](...args);
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file malformed input forbidden"); };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    vi.stubGlobal("Uint8Array", new Proxy(Native, { construct(target, args) {
        const first = args[0], length = typeof first === "number" ? first : first?.byteLength ?? first?.length ?? 0;
        maxAllocation = Math.max(maxAllocation, length); if (length > 65536) throw new Error("whole malformed image allocation");
        return Reflect.construct(target, args);
    } }));
    let actual;
    try {
        const running = runner(args, { filesystem, cwd: "/" }, undefined, controller.signal);
        if (failureMode === "none") actual = await running;
        else await expect(running).rejects.toBe(failure);
    }
    finally { vi.unstubAllGlobals(); }
    if (failureMode === "none") expect(actual).toEqual(expected);
    expect(maxAllocation).toBeLessThanOrEqual(65536);
    expect(readBytes).toBeLessThan(size + 16384);
    expect(closed).toBe(opened);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input"]);
});
