import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { decodeImage, tryImageFile } from "./index.js";

it.each(["complete", "truncated", "cleanup failure"])("publishes an encoded snapshot: %s", async mode => {
    const bytes = await sharp({ create: { width: 17, height: 11, channels: 4, background: "red" } }).png().toBuffer();
    const { data: ignored, ...image } = decodeImage(bytes), fs = new MemoryFileSystem(), original = new Uint8Array([7, 8, 9]);
    await fs.writeFile("/out.png", original);
    let retired = false;
    const cleanupError = new Error("snapshot cleanup failed");
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file snapshot I/O forbidden"); };
        if (key === "publishStagedFile") return async (...args: Parameters<typeof fs.publishStagedFile>) => {
            expect(retired).toBe(true);
            return fs.publishStagedFile(...args);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const info = { format: "png", width: image.width, height: image.height, channels: 4, premultiplied: false, size: bytes.length };
    const result = tryImageFile({ image: { ...image, position: 123 }, storage: {
        allocate() { throw new Error("snapshot must not allocate pixels"); },
        async read() { throw new Error("snapshot must not read pixels"); },
        async write() { throw new Error("snapshot must not write pixels"); }
    }, encoded: { info, source: { size: bytes.length, async read(position, length) {
        expect(retired).toBe(false); expect(length).toBeLessThanOrEqual(16384);
        return bytes.subarray(position, position + length - (mode === "truncated" ? 1 : 0));
    } } }, async close() { retired = true; if (mode === "cleanup failure") throw cleanupError; } }, "/out.png", { filesystem, workingDirectory: "/" }, { format: "png" });
    if (mode === "complete") {
        expect(await result).toEqual(info);
        expect(await fs.readFile("/out.png")).toEqual(bytes);
    } else {
        if (mode === "cleanup failure") await expect(result).rejects.toBe(cleanupError);
        else await expect(result).rejects.toThrow("Truncated encoded image snapshot");
        expect(await fs.readFile("/out.png")).toEqual(original);
    }
    expect(retired).toBe(true);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["out.png"]);
});
it("owns published chunks when an encoded source lends its read window", async () => {
    const width = 101, height = 101, pixels = new Uint8Array(width * height * 4);
    let random = 1234567;
    for (let i = 0; i < pixels.length; i++) { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; pixels[i] = random & 255; }
    const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
    expect(bytes.length).toBeGreaterThan(32768);
    const { data: ignored, ...image } = decodeImage(bytes), fs = new MemoryFileSystem(), window = new Uint8Array(16384);
    const capabilities = { ...fs.capabilities, atomicFilePublication: true };
    let retired = false;
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "capabilities") return capabilities;
        if (key === "capabilitiesFor") return async () => capabilities;
        if (key === "publishFileConditional") return async (path: string, source: AsyncIterable<Uint8Array>) => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of source) chunks.push(chunk);
            expect(retired).toBe(true);
            const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
            let offset = 0;
            for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
            expect(output).toEqual(bytes);
            await fs.writeFile(path, output);
            return fs.stat(path);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const info = { format: "png", width, height, channels: 4, premultiplied: false, size: bytes.length };
    expect(await tryImageFile({ image: { ...image, position: 123 }, storage: {
        allocate() { throw new Error("unexpected pixel allocation"); }, async read() { throw new Error("unexpected pixel read"); }, async write() { throw new Error("unexpected pixel write"); }
    }, encoded: { info, source: { size: bytes.length, async read(position, length) { window.set(bytes.subarray(position, position + length)); return window.subarray(0, length); } } }, async close() { retired = true; } }, "/out.png", { filesystem, workingDirectory: "/" }, { format: "png" })).toEqual(info);
});
