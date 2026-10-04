import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const pipelines = [
    ["input", "info:"],
    ["input", "-format", "%f %wx%h %b %[mean] %[fx:u.r] %[pixel:p{1,1}]", "info:"],
    ["input", "+clone", "-resize", "3x4!", "-format", "%s/%n:%f:%wx%h;", "info:-"],
    ["input", "txt:-"],
    ["input", "txt:pixels.txt"],
    ["input", "histogram:info:-"],
    ["input", "+clone", "-negate", "txt:-"],
    ["-size", "2x3", "xc:#12345680", "histogram:foo"]
];
it.each(pipelines.flatMap(args => [false, true].map(streamed => ({ args, streamed }))))("retains text $args streamed=$streamed", async ({ args, streamed }) => {
    const fs = new MemoryFileSystem(), bytes = await sharp(Uint8Array.from({ length: 24 * 19 * 4 }, (_, i) => i * 37 % 256), { raw: { width: 24, height: 19, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    const files = new Map([["input", bytes]]), expected = await runConvertCli(args, files), chunks: Uint8Array[] = [];
    expect(expected.exitCode).toBe(0);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file text I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const actual = await runConvertCli(args, { filesystem, cwd: "/", ...(streamed ? { stdout: { async write(bytes: Uint8Array) { expect(bytes.length).toBeLessThanOrEqual(16384); chunks.push(new Uint8Array(bytes)); } } } : {}) });
    expect(actual).toEqual({ ...expected, stdout: streamed ? "" : expected.stdout });
    if (streamed) expect(chunks.map(chunk => new TextDecoder().decode(chunk)).join("")).toBe(expected.stdout);
    if (files.has("pixels.txt")) expect(await fs.readFile("/pixels.txt")).toEqual(files.get("pixels.txt"));
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual([...files.keys()].sort());
});

it("retains histogram encounter order and counts across cache eviction", async () => {
    const fs = new MemoryFileSystem(), pixels = new Uint8Array(1031 * 3 * 4);
    for (let index = 0; index < pixels.length / 4; index++) {
        const key = index % 2062;
        pixels.set([key >>> 16, key >>> 8 & 255, key & 255, 255], index * 4);
    }
    const bytes = await sharp(pixels, { raw: { width: 1031, height: 3, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    const expected = await runConvertCli(["input", "histogram:info:-"], new Map([["input", bytes]]));
    expect(expected.stdout.length).toBeGreaterThan(65536);
    const chunks: Uint8Array[] = [];
    expect(await runConvertCli(["input", "histogram:info:-"], { filesystem: fs, cwd: "/", stdout: { async write(bytes) { chunks.push(new Uint8Array(bytes)); } } })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(chunks.map(chunk => new TextDecoder().decode(chunk)).join("")).toBe(expected.stdout);
});

it("keeps Unicode formatted output intact across owned streamed chunks", async () => {
    const fs = new MemoryFileSystem(), text = "a".repeat(4095) + "😀<&".repeat(2000), chunks: Uint8Array[] = [];
    const expected = await runConvertCli(["xc:red", "-format", text, "info:"], new Map());
    expect(await runConvertCli(["xc:red", "-format", text, "info:"], { filesystem: fs, cwd: "/", stdout: { async write(bytes) { chunks.push(bytes); } } })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map(chunk => new TextDecoder().decode(chunk)).join("")).toBe(expected.stdout);
});

it("preserves the previous text file and removes staging when publication is cancelled", async () => {
    const fs = new MemoryFileSystem(), controller = new AbortController(), reason = new Error("cancel text publication"), old = new TextEncoder().encode("previous contents");
    await fs.writeFile("/pixels.txt", old);
    let entered = false;
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file text I/O forbidden"); };
        if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
            const staged = await fs.createStagedFile(...args), writer = staged.writer!;
            return { ...staged, writer: { ...writer, async write(...args: Parameters<typeof writer.write>) { entered = true; await writer.write(...args); controller.abort(reason); }, finish: writer.finish.bind(writer) } };
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(runConvertCli(["-size", "103x97", "gradient:red-blue", "txt:pixels.txt"], { filesystem, cwd: "/" }, undefined, controller.signal)).rejects.toBe(reason);
    expect(entered).toBe(true);
    expect(await fs.readFile("/pixels.txt")).toEqual(old);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["pixels.txt"]);
});

it.each([false, true])("preserves surrogate boundaries between formatted frames, streamed=%s", async streamed => {
    const fs = new MemoryFileSystem(), args = ["xc:red", "+clone", "-format", "\udc00x\ud800", "info:"], chunks: Uint8Array[] = [];
    const expected = await runConvertCli(args, new Map());
    const actual = await runConvertCli(args, { filesystem: fs, cwd: "/", ...(streamed ? { stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } } } : {}) });
    expect(actual).toEqual({ ...expected, stdout: streamed ? "" : expected.stdout });
    if (streamed) expect(chunks.flatMap(chunk => [...chunk])).toEqual([...new TextEncoder().encode(expected.stdout)]);
});
