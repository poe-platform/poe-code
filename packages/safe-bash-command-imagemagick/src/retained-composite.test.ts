import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createCompositeCommand, createMagickCommand, runCompositeCli, runMagickCli } from "./index.js";

for (const entry of ["sdk", "magick-sdk", "command", "magick-command"] as const)
for (const settings of [[], ["-compose", "multiply"], ["-gravity", "center", "-geometry", "7x9+2-1"], ["-dissolve", "33x67"], ["-blend", "40x60"], ["-watermark", "25"], ["-compose", "copyalpha"]])
it(`retains composite via ${entry} ${settings.join(" ")}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    for (const [name, width, height] of [["base", 19, 23], ["overlay", 11, 13]] as const) {
        const bytes = await sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
        files.set(name, bytes); await fs.writeFile("/" + name, bytes);
    }
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file composite I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = [...settings, "overlay", "base", "out.png"], expected = await runCompositeCli(args, files);
    expect(expected.exitCode).toBe(0);
    if (entry === "sdk" || entry === "magick-sdk") {
        const runner = entry === "sdk" ? runCompositeCli : runMagickCli;
        expect(await runner(entry === "sdk" ? args : ["composite", ...args], { filesystem, cwd: "/" })).toEqual(expected);
    } else {
        const command = entry === "command" ? createCompositeCommand() : createMagickCommand(), arguments_ = createCommandArguments(entry === "command" ? args : ["composite", ...args]);
        const sink = { async write() {} };
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink } as CommandContext)).toEqual({ exitCode: 0 });
    }
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["base", "out.png", "overlay"]);
});

it("keeps a cumulative input budget and leaves output untouched on rejection", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 13, height: 17, channels: 4, background: "red" } }).png().toBuffer();
    await fs.writeFile("/base", bytes); await fs.writeFile("/overlay", bytes);
    const failure = new Error("composite input budget"), totals: number[] = [];
    await expect(runCompositeCli(["overlay", "base", "out.png"], { filesystem: fs, cwd: "/", inputBudget: { check(total) { totals.push(total); if (total > bytes.length) throw failure; } } })).rejects.toBe(failure);
    expect(totals.at(-1)).toBe(bytes.length * 2);
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["base", "overlay"]);
});

it.each([false, true])("preserves missing operand diagnostics with streamed stderr=%s", async streamed => {
    const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [], args = ["-blend", "50", "only-one"];
    const expected = await runCompositeCli(args, new Map());
    expect(await runCompositeCli(args, { filesystem: fs, cwd: "/", ...(streamed ? { stderr: { async write(bytes: Uint8Array) { chunks.push(bytes); } } } : {}) })).toEqual({ ...expected, stderr: streamed ? "" : expected.stderr });
    if (streamed) expect(chunks.map(chunk => new TextDecoder().decode(chunk)).join("")).toBe(expected.stderr);
    expect(await fs.readdir("/")).toEqual([]);
});

it.each(["multiply", "dstover", "over", "unknown-mode"].flatMap(mode => ["+2+3", "+999+999"].map(geometry => ({ mode, geometry }))))("preserves opaque blend metadata for $mode at $geometry", async ({ mode, geometry }) => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 17, height: 19, channels: 3, background: "red" } }).bmp().toBuffer();
    await fs.writeFile("/input", bytes);
    const files = new Map([["input", bytes]]), args = ["-compose", mode, "-geometry", geometry, "input", "input", "out.png"];
    expect(await runCompositeCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runCompositeCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});

it("preserves retained read failures before reporting missing operands", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "red" } }).png().toBuffer(), failure = new Error("remote input read failed");
    await fs.writeFile("/input", bytes);
    let closed = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
            const handle = await fs.openReadFile(...args);
            return { stat: handle.stat.bind(handle), async read() { throw failure; }, async close() { closed++; await handle.close(); } };
        };
        if (key === "readFile" || key === "readStream") return () => { throw failure; };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(runCompositeCli(["input", "out.png"], { filesystem, cwd: "/" })).rejects.toBe(failure);
    expect(closed).toBe(1);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input"]);
});
