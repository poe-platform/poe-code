import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMontageCommand, createMagickCommand, runMontageCli, runMagickCli } from "./index.js";

for (const entry of ["sdk", "magick-sdk", "command", "magick-command"] as const)
for (const settings of [[], ["-tile", "2x1"], ["-geometry", "7x9+1+3", "-gravity", "southeast"], ["-border", "2", "-bordercolor", "#13579b81", "-background", "#2468ac71"], ["-geometry", "13x11+0+0", "-border", "1", "-background", "none"]])
it(`retains montage via ${entry} ${settings.join(" ")}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    for (const [name, width, height] of [["a", 19, 23], ["b", 11, 13], ["c", 17, 7]] as const) {
        const bytes = await sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer();
        files.set(name, bytes); await fs.writeFile("/" + name, bytes);
    }
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file montage I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = [...settings, "a", "b", "c", "out.png"], expected = await runMontageCli(args, files);
    expect(expected.exitCode).toBe(0);
    if (entry === "sdk" || entry === "magick-sdk") {
        const runner = entry === "sdk" ? runMontageCli : runMagickCli;
        expect(await runner(entry === "sdk" ? args : ["montage", ...args], { filesystem, cwd: "/" })).toEqual(expected);
    } else {
        const command = entry === "command" ? createMontageCommand() : createMagickCommand(), arguments_ = createCommandArguments(entry === "command" ? args : ["montage", ...args]);
        const sink = { async write() {} };
        expect(await command.execute({ command: command.name, args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: sink, stderr: sink } as CommandContext)).toEqual({ exitCode: 0 });
    }
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a", "b", "c", "out.png"]);
});

it.each([[], ["-geometry", "11x7+0+0"], ["-tile", "2x1", "-border", "2"]].map(settings => [settings]))("preserves animated input selections and generated operands: %j", async settings => {
    const fs = new MemoryFileSystem();
    const bytes = await sharp(Uint8Array.from({ length: 9 * 10 * 4 }, (_, i) => i % 4 === 3 ? 255 : i * 59 % 256), { raw: { width: 9, height: 10, channels: 4 } }).gif({ pageHeight: 5 }).toBuffer();
    await fs.writeFile("/input.gif", bytes);
    const files = new Map([["input.gif", bytes]]), args = [...settings, "input.gif[1,0]", "xc:red", "out.png"];
    expect(await runMontageCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runMontageCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input.gif", "out.png"]);
});

it("evicts layout and frame metadata while preserving every tile", async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), args: string[] = ["-geometry", "2x3+0+0", "-tile", "13x"];
    for (let i = 0; i < 141; i++) {
        const name = "tile" + i, bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: { r: i, g: 255 - i, b: i * 3 % 256 } } }).png().toBuffer();
        files.set(name, bytes); await fs.writeFile("/" + name, bytes); args.push(name);
    }
    args.push("out.png");
    expect(await runMontageCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runMontageCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect((await fs.readdir("/")).length).toBe(142);
});

it.each([[], ["missing", "out.png"], ["corrupt", "out.png"], ["-geometry", "5x5", "corrupt", "out.png"]].map(args => [args]))("preserves montage diagnostics and cleanup: %j", async args => {
    const fs = new MemoryFileSystem(), bytes = Uint8Array.of(1, 2, 3), files = new Map([["corrupt", bytes]]);
    await fs.writeFile("/corrupt", bytes);
    expect(await runMontageCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runMontageCli(args, files));
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["corrupt"]);
});

it("retains the original input after its path is replaced during layout", async () => {
    const fs = new MemoryFileSystem(), original = await sharp({ create: { width: 7, height: 9, channels: 3, background: "red" } }).png().toBuffer(), replacement = await sharp({ create: { width: 13, height: 11, channels: 3, background: "blue" } }).png().toBuffer();
    await fs.writeFile("/input", original);
    let reads = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
            const handle = await fs.openReadFile(...args); reads++;
            return { stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() { await handle.close(); await fs.writeFile("/input", replacement); } };
        };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    const files = new Map([["input", original]]), args = ["input", "out.png"];
    expect(await runMontageCli(args, { filesystem, cwd: "/" })).toEqual(await runMontageCli(args, files));
    expect(reads).toBe(1);
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});

it("awaits owned stdout chunks and retires all backing after cancellation", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 131, height: 137, channels: 3, background: "red" } }).bmp().toBuffer();
    await fs.writeFile("/input", bytes);
    const controller = new AbortController(), failure = new Error("stop montage stdout");
    let writes = 0, writing = false;
    await expect(runMontageCli(["input", "input", "bmp:-"], { filesystem: fs, cwd: "/", stdout: { async write(chunk) {
        expect(writing).toBe(false); writing = true;
        const snapshot = new Uint8Array(chunk); await Promise.resolve(); expect(chunk).toEqual(snapshot);
        writing = false; if (++writes === 3) controller.abort(failure);
    } } }, undefined, controller.signal)).rejects.toBe(failure);
    expect(writes).toBe(3);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input"]);
});

it("enforces cumulative input admission before publishing a montage", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 7, height: 9, channels: 3, background: "red" } }).png().toBuffer(), old = Uint8Array.of(5, 6, 7), failure = new Error("montage input limit");
    await fs.writeFile("/input", bytes); await fs.writeFile("/out.png", old);
    await expect(runMontageCli(["input", "input", "out.png"], { filesystem: fs, cwd: "/", inputBudget: { check(total) { if (total > bytes.length) throw failure; } } })).rejects.toBe(failure);
    expect(await fs.readFile("/out.png")).toEqual(old);
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input", "out.png"]);
});

it("preserves the output when cancellation interrupts source snapshotting", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 101, height: 103, channels: 3, background: "red" } }).bmp().toBuffer(), old = Uint8Array.of(5, 6, 7), failure = new Error("cancel montage read"), controller = new AbortController();
    await fs.writeFile("/input", bytes); await fs.writeFile("/out.png", old);
    let closed = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
            const handle = await fs.openReadFile(...args);
            return { stat: handle.stat.bind(handle), async read(...args: Parameters<typeof handle.read>) { const chunk = await handle.read(...args); controller.abort(failure); return chunk; }, async close() { closed++; await handle.close(); } };
        };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(runMontageCli(["input", "out.png"], { filesystem, cwd: "/" }, undefined, controller.signal)).rejects.toBe(failure);
    expect(closed).toBe(1); expect(await fs.readFile("/out.png")).toEqual(old);
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input", "out.png"]);
});

it("preserves wide PNG tile alpha rounding across bounded spans", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp(Uint8Array.from({ length: 12001 * 3 * 4 }, (_, index) => index * 73 % 256), { raw: { width: 12001, height: 3, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    const files = new Map([["input", bytes]]), args = ["-background", "#98765473", "-border", "1", "-bordercolor", "#12345689", "input", "out.png"];
    expect(await runMontageCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runMontageCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
