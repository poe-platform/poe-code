import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { bindFileOutputBudget } from "safe-bash-contracts/filesystem-output-budget";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCompareCommand, createMagickCommand, runCompareCli } from "./index.js";
for (const format of ["png", "jpeg", "webp", "tiff", "gif", "bmp", "ppm", "heif", "pdf"] as const)
    it(`compares retained ${format} files and publishes an identical diff`, async () => {
        const a = await sharp({ create: { width: 17, height: 11, channels: 4, background: "red" } }).toFormat(format).toBuffer(), b = await sharp({ create: { width: 13, height: 15, channels: 4, background: "blue" } }).toFormat(format).toBuffer();
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a", a);
        await fs.writeFile("/b", b);
        const filesystem = new Proxy(fs, { get(target, key) { if (key === "readFile" || key === "writeFile")
                return () => { throw new Error("whole-file comparison I/O forbidden"); }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
        const files = new Map([["a", a], ["b", b]]), args = ["-metric", "RMSE", "a", "b", "out.png"], expected = await runCompareCli(args, files);
        expect(await runCompareCli(args, { filesystem, cwd: "/" })).toEqual(expected);
        expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
        expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a", "b", "out.png"]);
    });
it("keeps the destination intact if retained stdin cleanup fails", async () => {
    const bytes = await sharp({ create: { width: 601, height: 601, channels: 4, background: "red" } }).bmp().toBuffer(), fs = new MemoryFileSystem(), reason = new Error("stdin close failed");
    await fs.writeFile("/out.png", new TextEncoder().encode("original"));
    let opened = 0;
    const filesystem = new Proxy(fs, { get(target, key) { if (key === "open")
            return async (...args: Parameters<typeof fs.open>) => { const handle = await fs.open(...args), stdinHandle = ++opened === 1; return new Proxy(handle, { get(target, key) { if (key === "close")
                    return async (...args: Parameters<typeof handle.close>) => { await handle.close(...args); if (stdinHandle)
                        throw reason; }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } }); }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
    const stdin = (async function* () { for (let offset = 0; offset < bytes.length; offset += 16384)
        yield bytes.subarray(offset, offset + 16384); })();
    await expect(runCompareCli(["-", "-", "out.png"], { filesystem, cwd: "/", stdin })).rejects.toBe(reason);
    expect(new TextDecoder().decode(await fs.readFile("/out.png"))).toBe("original");
});
for (const operand of ["png:a[0]", "a[-1]", "a[0-1]", "a[1,0]", "a[5x7]", "a[150%]", "a[5x7!]", "a[5x7^]", "a[20@]", "a[5x7+2+3]", "a[5x7-2-3]", "a[5x7+99+99]", "tile:a", "xc:red", "gradient:red-blue", "pattern:checkerboard", "rose:", "label:hello"])
    it(`preserves comparison operand ${operand}`, async () => {
        const data = Uint8Array.from({ length: 17 * 11 * 4 }, (_, i) => (i * 17 + 53) % 256), bytes = await sharp(data, { raw: { width: 17, height: 11, channels: 4 } }).png().toBuffer(), fs = new MemoryFileSystem();
        await fs.writeFile("/a", bytes);
        const args = ["-metric", "MAE", operand, "a", "null:"];
        expect(await runCompareCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runCompareCli(args, new Map([["a", bytes]])));
        expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["a"]);
    });
for (const magick of [false, true])
    it(`streams the ${magick ? "magick compare" : "compare"} command output`, async () => {
        const bytes = await sharp({ create: { width: 17, height: 11, channels: 4, background: "red" } }).png().toBuffer(), fs = new MemoryFileSystem();
        await fs.writeFile("/a", bytes);
        let stderr = "";
        const chunks: Uint8Array[] = [];
        const command = magick ? createMagickCommand() : createCompareCommand(), args = createCommandArguments([...(magick ? ["compare"] : []), "a", "a", "bmp:-"]);
        const result = await command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () { })(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        const expected = await runCompareCli(["a", "a", "bmp:-"], new Map([["a", bytes]])), output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
            output.set(chunk, offset);
            offset += chunk.length;
        }
        expect({ ...result, stderr }).toEqual({ exitCode: expected.exitCode, stderr: expected.stderr });
        expect(decodeImage(output)).toEqual(decodeImage(expected.stdoutBytes!));
        expect(chunks.length).toBeGreaterThan(1);
    });
for (const symlink of [false, true])
    it(`preserves the destination on output budget failure, symlink=${symlink}`, async () => {
        const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 17, height: 11, channels: 4, background: "red" } }).png().toBuffer(), original = new TextEncoder().encode("original"), reason = new Error("output budget exceeded");
        await fs.writeFile("/a", bytes);
        await fs.writeFile("/target", original);
        if (symlink)
            await fs.symlink("/target", "/out.png");
        else
            await fs.writeFile("/out.png", original);
        const args = createCommandArguments(["a", "a", "out.png"]), context: CommandContext = { command: "compare", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () { })(), registerCleanup() { }, stdout: { async write() { } }, stderr: { async write() { } } };
        bindFileOutputBudget(context, () => ({ async write() { throw reason; } }));
        await expect(createCompareCommand().execute(context)).rejects.toBe(reason);
        expect(await fs.readFile("/out.png")).toEqual(original);
        if (symlink)
            expect((await fs.lstat("/out.png")).type).toBe("symlink");
        expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a", "out.png", "target"]);
    });
for (const bytes of [new Uint8Array(), new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0]), new TextEncoder().encode("not an image")])
    it(`preserves comparison decode diagnostics for ${bytes.length} bytes`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/a", bytes);
        const args = ["a", "a", "null:"];
        expect(await runCompareCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runCompareCli(args, new Map([["a", bytes]])));
    });
it("preserves a retained input close failure instead of formatting it as a decode error", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "red" } }).png().toBuffer(), reason = { failure: "close failed" };
    await fs.writeFile("/a", bytes);
    const filesystem = new Proxy(fs, { get(target, key) { if (key === "openReadFile")
            return async (...args: Parameters<typeof fs.openReadFile>) => { const handle = await fs.openReadFile(...args); return { stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() { await handle.close(); throw reason; } }; }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
    await expect(runCompareCli(["a", "a", "out.png"], { filesystem, cwd: "/" })).rejects.toBe(reason);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["a"]);
});
it("awaits retained source cleanup when cancellation interrupts input", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "red" } }).png().toBuffer(), reason = new Error("cancel compare"), controller = new AbortController();
    await fs.writeFile("/a", bytes);
    let closed = 0;
    const filesystem = new Proxy(fs, { get(target, key) { if (key === "openReadFile")
            return async (...args: Parameters<typeof fs.openReadFile>) => { const handle = await fs.openReadFile(...args); return { stat: handle.stat.bind(handle), async read(...args: Parameters<typeof handle.read>) { const bytes = await handle.read(...args); controller.abort(reason); return bytes; }, async close() { await handle.close(); closed++; } }; }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
    await expect(runCompareCli(["a", "a", "out.png"], { filesystem, cwd: "/" }, undefined, controller.signal)).rejects.toBe(reason);
    expect(closed).toBe(1);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["a"]);
});
