import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI, using the same opaque PNG through inline:data.
for (const retained of [false, true])
for (const vertical of [false, true])
it.each([
    ["0x1", [31, 100, 169]],
    ["0x2", [19, 100, 181]],
    ["1x1", [36, 100, 164]],
    ["2", [32, 100, 168]],
    ["0x1+0", [50, 100, 150]],
    ["0x1+2", [13, 100, 187]],
    ["0x1+1+0.2", [50, 100, 150]],
    ["0x1+1+0", [31, 100, 169]],
    ["0x0", [50, 100, 150]],
    ["0x1-1+0", [69, 100, 131]],
    ["0x0.5", [42, 100, 158]]
] as const)(`matches native unsharp %s (retained=${retained}, vertical=${vertical})`, async (geometry, expected) => {
    const input = await sharp(Uint8Array.from([50, 100, 150].flatMap(value => [value, value, value, 255])), {
        raw: { width: vertical ? 1 : 3, height: vertical ? 3 : 1, channels: 4 }
    }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-unsharp", geometry, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data)).toEqual(expected.flatMap(value => [value, value, value, 255]));
});

for (const retained of [false, true])
it.each([
    ["0x1", [95, 100, 105]],
    ["0x1+1", [95, 100, 105]],
    ["0x1+1+0", [93, 100, 107]]
] as const)(`applies the default threshold unless explicitly zero (retained=${retained}): %s`, async (geometry, expected) => {
    const input = await sharp(Uint8Array.from([95, 100, 105].flatMap(value => [value, value, value, 255])), {
        raw: { width: 3, height: 1, channels: 4 }
    }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-unsharp", geometry, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual(expected.flatMap(value => [value, value, value, 255]));
});

for (const retained of [false, true])
it.each([
    [[], [80, 90, 100, 255, 109, 119, 129, 169, 138, 148, 158, 0]],
    [["-channel", "R"], [80, 90, 100, 255, 109, 110, 120, 160, 138, 130, 140, 35]],
    [["-channel", "A"], [80, 90, 100, 255, 100, 110, 120, 169, 120, 130, 140, 0]],
    [["-channel", "RGB"], [80, 90, 100, 255, 109, 119, 129, 160, 138, 148, 158, 35]]
] as const)(`matches native unsharp with transparency and channel selection (retained=${retained}): %j`, async (options, expected) => {
    const input = await sharp(Uint8Array.from([80, 90, 100, 255, 100, 110, 120, 160, 120, 130, 140, 35]), {
        raw: { width: 3, height: 1, channels: 4 }
    }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", ...options, "-unsharp", "0x1", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    expect(Array.from(decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!).data)).toEqual(expected);
});

it.each(["edge", "tile", "mirror"])("keeps unsharp filesystem I/O bounded across row chunks (%s)", async method => {
    const input = await sharp(Uint8Array.from({ length: 1031 * 3 * 4 }, (_, i) => i % 4 === 3 ? 255 : i * 37 % 256), {
        raw: { width: 1031, height: 3, channels: 4 }
    }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file unsharp I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = ["input.png", "-virtual-pixel", method, "-unsharp", "0x1+2+0.05", "out.png"];
    expect((await runConvertCli(args, files)).exitCode).toBe(0);
    expect((await runConvertCli(args, { filesystem, cwd: "/" })).exitCode).toBe(0);
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
