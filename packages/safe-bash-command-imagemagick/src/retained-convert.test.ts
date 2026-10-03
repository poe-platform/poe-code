import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { bindFileOutputBudget } from "safe-bash-contracts/filesystem-output-budget";
import { expect, it, vi } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createConvertCommand, createMagickCommand, runMagickCli, runConvertCli } from "./index.js";
for (const operators of [[], ["-resize", "9x7!"], ["-flip"], ["-flop"], ["-rotate", "90"], ["-gamma", "1.4"], ["-colorspace", "gray"], ["-blur", "0x1"], ["-border", "2x3"], ["-crop", "7x5+2+3"], ["-gravity", "south", "-crop", "20x19-2-3"], ["-crop", "2x3@"], ["-shave", "2x3"], ["-shave", "99x99"], ["-bordercolor", "red", "-border", "3", "-trim"], ["-median", "3"], ["-background", "red", "-gravity", "center", "-extent", "20x25"], ["-extent", "7x5"], ["-gravity", "southeast", "-extent", "5x7-3+2"], ["-extent", "10x10+99+99"], ["-frame", "3x2"], ["-negate"], ["+negate"], ["-channel", "RGBA", "-negate"], ["-contrast"], ["+contrast"], ["-sigmoidal-contrast", "4x40%"], ["+sigmoidal-contrast", "4x40%"], ["-level", "20%,80%,1.3"], ["+level", "20%,80%,1.3"], ["-black-threshold", "30%"], ["-white-threshold", "70%"], ["-sepia-tone", "80%"], ["-solarize", "30%"], ["-posterize", "4"], ["-colors", "6"], ["-fill", "blue", "-fuzz", "20%", "-opaque", "red"], ["+opaque", "red"], ["-transparent", "red"], ["+transparent", "red"], ["-channel", "RGBA", "-evaluate", "Add", "20%", "+channel", "-evaluate", "Multiply", "1.4"], ["-channel", "B", "-function", "Polynomial", "0.5,0.2"], ["-evaluate", "Multiply", "1.4"], ["-function", "Polynomial", "0.5,0.2"], ["-modulate", "110,90,70"], ["-brightness-contrast", "10x20"], ["-monochrome"], ["-threshold", "30%"], ["-fill", "blue", "-tint", "60%"], ["-fill", "green", "-colorize", "50%"]]) {
    it(`converts retained files with ${operators.join(" ")}`, async () => {
        const pixels = Uint8Array.from({ length: 13 * 17 * 4 }, (_, index) => index * 37 % 256);
        const bytes = await sharp(pixels, { raw: { width: 13, height: 17, channels: 4 } }).png().toBuffer();
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", bytes);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file conversion I/O forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        const args = ["input", ...operators, "out.png"], files = new Map([["input", bytes]]);
        expect(await runConvertCli(args, { filesystem, cwd: "/" })).toEqual(await runConvertCli(args, files));
        expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
        expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input", "out.png"]);
    });
}

it.each(["tile:frames.gif", "tile:frames.gif[-1]", "frames.gif", "frames.gif[-1]", "frames.gif[0,1]", "frames.gif[1,0]"])("preserves selected final frames for %s", async operand => {
    const red = await sharp({ create: { width: 13, height: 17, channels: 4, background: "red" } }).png().toBuffer();
    const blue = await sharp({ create: { width: 13, height: 17, channels: 4, background: "blue" } }).png().toBuffer();
    const files = new Map([["red", red], ["blue", blue]]);
    await runConvertCli(["red", "blue", "frames.gif"], files);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/frames.gif", files.get("frames.gif")!);
    const args = [operand, "-flip", "out.png"];
    expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runConvertCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
it("preserves JPEG reduced DCT decoding and ordered settings", async () => {
    const bytes = await sharp(Uint8Array.from({ length: 128 * 96 * 4 }, (_, i) => i * 37 % 256), { raw: { width: 128, height: 96, channels: 4 } }).jpeg().toBuffer();
    const files = new Map([["input", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input", bytes);
    const args = ["-quality", "43", "-rotate", "90", "input", "-resize", "32x24!", "-background", "red", "-rotate", "-20", "out.jpg"];
    expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runConvertCli(args, files));
    expect(decodeImage(await fs.readFile("/out.jpg"))).toEqual(decodeImage(files.get("out.jpg")!));
});
it.each(["-gamma", "-quality", "-resize"])("preserves the missing %s argument default", async option => {
    const bytes = await sharp({ create: { width: 13, height: 17, channels: 4, background: "red" } }).png().toBuffer(), files = new Map([["input", bytes]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input", bytes);
    const args = ["input", option, "out.png"];
    expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runConvertCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});

for (const magick of [false, true])
    it(`streams the ${magick ? "magick convert" : "convert"} command output`, async () => {
        const bytes = await sharp({ create: { width: 17, height: 11, channels: 4, background: "red" } }).png().toBuffer(), fs = new MemoryFileSystem();
        await fs.writeFile("/a", bytes);
        let stderr = "";
        const chunks: Uint8Array[] = [];
        const command = magick ? createMagickCommand() : createConvertCommand(), args = createCommandArguments([...(magick ? ["convert"] : []), "a", "-flip", "bmp:-"]);
        const result = await command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () { })(), stdout: { async write(bytes) { chunks.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        const expected = await runConvertCli(["a", "-flip", "bmp:-"], new Map([["a", bytes]])), output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
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
        const args = createCommandArguments(["a", "-flip", "out.png"]), context: CommandContext = { command: "convert", args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () { })(), registerCleanup() { }, stdout: { async write() { } }, stderr: { async write() { } } };
        bindFileOutputBudget(context, () => ({ async write() { throw reason; } }));
        await expect(createConvertCommand().execute(context)).rejects.toBe(reason);
        expect(await fs.readFile("/out.png")).toEqual(original);
        if (symlink)
            expect((await fs.lstat("/out.png")).type).toBe("symlink");
        expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["a", "out.png", "target"]);
    });

it.each([{ prefix: [] }, { prefix: ["convert"] }])("routes filesystem magick %j through retained conversion", async ({ prefix }) => {
    const bytes = await sharp({ create: { width: 13, height: 17, channels: 4, background: "red" } }).png().toBuffer(), fs = new MemoryFileSystem();
    await fs.writeFile("/a", bytes);
    const files = new Map([["a", bytes]]), args = [...prefix, "a", "-flip", "out.png"];
    expect(await runMagickCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runMagickCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});

it("preserves a retained input close failure instead of formatting it as a decode error", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "red" } }).png().toBuffer(), reason = { failure: "close failed" };
    await fs.writeFile("/a", bytes);
    const filesystem = new Proxy(fs, { get(target, key) { if (key === "openReadFile")
            return async (...args: Parameters<typeof fs.openReadFile>) => { const handle = await fs.openReadFile(...args); return { stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() { await handle.close(); throw reason; } }; }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
    await expect(runConvertCli(["a", "-flip", "out.png"], { filesystem, cwd: "/" })).rejects.toBe(reason);
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["a"]);
});
for (const operand of ["gradient:", "gradient:none-red", "radial-gradient:red-blue", "pattern:checkerboard", "plasma:fractal"])
for (const size of ["1x1", "3x19", "19x3"])
    it(`preserves generated ${operand} at ${size}`, async () => {
        const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), args = ["-size", size, operand, "out.png"];
        expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runConvertCli(args, files));
        expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
        expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["out.png"]);
    });

it.each(["-fill", "-opaque", "-transparent"])("preserves malformed %s diagnostics before file acquisition", async option => {
    const fs = new MemoryFileSystem(), args = [option, "invalid-color", "missing", "out.png"];
    expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runConvertCli(args, new Map()));
    expect(await fs.readdir("/")).toEqual([]);
});

for (const [width, height, canvasWidth, canvasHeight, format] of [[3, 7, 19, 23, "png"], [5003, 3, 5009, 5, "png"], [128, 96, 161, 127, "jpeg"]] as const) {
    it(`tiles ${width}x${height} ${format} across bounded row fragments`, async () => {
        const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256);
        const bytes = await sharp(pixels, { raw: { width, height, channels: 4 } }).toFormat(format).toBuffer();
        const fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
        await fs.writeFile("/input", bytes);
        const args = ["-size", `${canvasWidth}x${canvasHeight}`, "tile:input", "-resize", "17x11!", "out.png"];
        expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runConvertCli(args, files));
        expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    });
}
it("observes timer cancellation after loading a tile pattern and before output publication", async () => {
    vi.stubGlobal("setImmediate", undefined);
    vi.spyOn(performance, "now").mockReturnValue(0);
    const fs = new MemoryFileSystem(), controller = new AbortController(), reason = new Error("cancel tile expansion");
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "red" } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    let publicationStarted = false, closed = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
            const handle = await fs.openReadFile(...args);
            return { stat: handle.stat.bind(handle), read: handle.read.bind(handle), async close() { await handle.close(); closed++; timer = setTimeout(() => controller.abort(reason), 0); } };
        };
        if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => { publicationStarted = true; return fs.createStagedFile(...args); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    try {
        await expect(runConvertCli(["-size", "129x131", "tile:input", "out.png"], { filesystem, cwd: "/" }, undefined, controller.signal)).rejects.toBe(reason);
        expect(closed).toBe(1);
        expect(publicationStarted).toBe(false);
        expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input"]);
    } finally { clearTimeout(timer); vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
