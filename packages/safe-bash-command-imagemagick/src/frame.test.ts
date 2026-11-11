import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
it("rejects malformed frame geometry through the public command without replacing the destination", async () => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    expect(runConvertCliSync(["-size", "10x8", "gradient:black-white", "input.png"], files).exitCode).toBe(0);
    expect(runConvertCliSync(["-size", "1x1", "xc:#010101", "out.png"], files).exitCode).toBe(0);
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const args = createCommandArguments(["input.png", "-mattecolor", "red", "-frame", "bogus", "out.png"]);
    let stderr = "";
    const context = {
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
        registerCleanup() {}, fs: filesystem,
    } as unknown as CommandContext;
    expect((await createMagickCommand().execute(context)).exitCode).toBe(1);
    expect(stderr).toContain("invalid argument for option '-frame'");
    expect(await filesystem.readFile("/out.png")).toEqual(files.get("out.png"));
});

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { geometry: "1:2", horizontal: 1, vertical: 2 },
        { geometry: "2x", horizontal: 2, vertical: 0 },
        { geometry: "x2", horizontal: 0, vertical: 2 },
        { geometry: "2x0", horizontal: 2, vertical: 0 },
        { geometry: "0x2", horizontal: 0, vertical: 2 },
        { geometry: "2", horizontal: 2, vertical: 2 },
    ])(`frames only the specified axes, ${mode}: $geometry`, async ({ geometry, horizontal, vertical }) => {
        const data = Uint8Array.from({ length: 10 * 8 * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
        const input = encodeImage({ width: 10, height: 8, data, format: "png", depth: "uchar", density: 72, channels: 4, space: "srgb", hasAlpha: false }, { format: "png" }).data;
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-mattecolor", "red", "-frame", geometry, "png:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const image = decodeImage(result.stdoutBytes!);
        expect([image.width, image.height]).toEqual([10 + 2 * horizontal, 8 + 2 * vertical]);
        const expected = [];
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
            const inside = x >= horizontal && x < horizontal + 10 && y >= vertical && y < vertical + 8;
            const value = (y - vertical) * 10 + x - horizontal + 1;
            expected.push(...(inside ? [value, value, value, 255] : [255, 0, 0, 255]));
        }
        expect([...image.data]).toEqual(expected);
    });
    it.each(["bogus", "2xjunk", "", "+", "4x4oops", "2x2+2+1"])(`preserves the destination for invalid frame geometry %s, ${mode}`, async geometry => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        expect(runConvertCliSync(["-size", "10x8", "gradient:black-white", "input.png"], files).exitCode).toBe(0);
        expect(runConvertCliSync(["-size", "1x1", "xc:#010101", "out.png"], files).exitCode).toBe(0);
        const original = files.get("out.png")!.slice();
        for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
        const args = ["input.png", "-mattecolor", "red", "-frame", geometry, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        if (geometry !== "2x2+2+1") expect(result.stderr).toContain("invalid argument for option '-frame'");
        expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")).toEqual(original);
    });
    it.each([
        { options: [], corner: [189, 189, 189, 255] },
        { options: ["-mattecolor", "blue"], corner: [0, 0, 255, 255] },
        { options: ["-bordercolor", "green"], corner: [189, 189, 189, 255] },
    ])(`uses mattecolor for a flat frame, ${mode}: $options`, async ({ options, corner }) => {
        const args = ["-size", "1x1", "xc:red", ...options, "-frame", "2x2", "png:-"];
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const image = decodeImage(result.stdoutBytes!);
        expect([image.width, image.height]).toEqual([5, 5]);
        expect([...image.data.slice(0, 4)]).toEqual(corner);
        expect([...image.data.slice(48, 52)]).toEqual([255, 0, 0, 255]);
    });
    it(`renders all four bevel shades, ${mode}`, async () => {
        const args = ["-size", "1x1", "xc:red", "-frame", "3x3+1+1", "-depth", "8", "png:-"];
        const result = mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
        expect(result.exitCode, result.stderr).toBe(0);
        const image = decodeImage(result.stdoutBytes!);
        for (const [x, y, shade] of [[0, 0, 210], [0, 1, 221], [6, 1, 100], [0, 6, 82], [1, 1, 189], [2, 2, 82], [2, 3, 100], [4, 3, 221], [2, 4, 210]]) {
            const offset = (y! * image.width + x!) * 4;
            expect([...image.data.slice(offset, offset + 4)]).toEqual([shade, shade, shade, 255]);
        }
    });
    it.each(["2x2+2+1", "2x2-1-1"])(`rejects impossible bevels %s, ${mode}`, async geometry => {
        const args = ["xc:red", "-frame", geometry, "png:-"], files = new Map<string, Uint8Array>();
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
    });
    it.skipIf(!nativeAvailable).each([
        ["-frame", "1:2"],
        ["-frame", "3:3+1+1"],
        ["-frame", "2x"],
        ["-frame", "x2"],
        ["-frame", "2x0"],
        ["-frame", "0x2"],
        ["-frame", "2"],
        ["-frame", "3x3+1+1"],
        ["-mattecolor", "#5588bb", "-frame", "7x5+2+3"],
        ["-frame", "4x6+0+2"],
        ["-frame", "4x6+2+0"],
        ["-mattecolor", "blue", "-bordercolor", "green", "-frame", "3x3+1+1"],
        ["-mattecolor", "blue", "-bordercolor", "red", "-border", "3x2"],
    ])(`matches native frame and border pixels, ${mode}: %j`, async (...options) => {
        const args = ["-size", "3x2", options.includes("-border") ? "xc:red" : "xc:#ff000080", ...options, "png:-"];
        const result = mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "retained" ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
        expect(result.exitCode, result.stderr).toBe(0);
        const reference = spawnSync("magick", [...args.slice(0, -1), "-depth", "8", "png:-"]);
        expect(reference.status, reference.stderr.toString()).toBe(0);
        const actual = decodeImage(result.stdoutBytes!), expected = decodeImage(reference.stdout);
        expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
        expect(Math.max(...actual.data.map((value, i) => Math.abs(value - expected.data[i]!)))).toBeLessThanOrEqual(1);
    });
}

it("applies mattecolor and frame through mogrify", async () => {
    const files = new Map<string, Uint8Array>();
    expect(runConvertCliSync(["-size", "1x1", "xc:red", "input.png"], files).exitCode).toBe(0);
    const result = await runMogrifyCli(["-mattecolor", "blue", "-frame", "2x2", "input.png"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    const image = decodeImage(files.get("input.png")!);
    expect([image.width, image.height]).toEqual([5, 5]);
    expect([...image.data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
});

it("reads colon-separated frame dimensions through the public command", async () => {
    const data = Uint8Array.from({ length: 10 * 8 * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
    const input = encodeImage({ width: 10, height: 8, data, format: "png", depth: "uchar", density: 72, channels: 4, space: "srgb", hasAlpha: false }, { format: "png" }).data;
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const argumentValues = createCommandArguments(["input.png", "-mattecolor", "red", "-frame", "1:2", "out.png"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(0);
    const image = decodeImage(await fs.readFile("/out.png"));
    expect([image.width, image.height]).toEqual([12, 12]);
    for (let y = 0; y < 8; y++) {
        const offset = ((y + 2) * image.width + 1) * 4;
        expect(image.data.slice(offset, offset + 40)).toEqual(data.slice(y * 40, (y + 1) * 40));
    }
    expect([...image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
});
