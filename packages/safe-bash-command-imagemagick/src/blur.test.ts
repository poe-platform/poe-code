import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true])
for (const vertical of [false, true])
it.each([
    ["-blur", "0x1", [177, 62, 17, 255, 78, 98, 78, 255, 17, 62, 177, 255]],
    ["-gaussian-blur", "0x1", [178, 62, 15, 255, 77, 102, 77, 255, 15, 62, 178, 255]],
    ["-blur", "1x1", [184, 71, 0, 255, 71, 113, 71, 255, 0, 71, 184, 255]],
    ["-gaussian-blur", "1x1", [185, 70, 0, 255, 70, 115, 70, 255, 0, 70, 185, 255]],
    ["-blur", "0x2", [153, 45, 58, 255, 102, 50, 102, 255, 58, 45, 153, 255]],
    ["-gaussian-blur", "0x2", [153, 45, 57, 255, 102, 51, 102, 255, 57, 45, 153, 255]],
    ["-blur", "2x0.5", [216, 39, 0, 255, 39, 176, 39, 255, 0, 39, 216, 255]],
    ["-gaussian-blur", "2x0.5", [228, 27, 0, 255, 27, 201, 27, 255, 0, 27, 228, 255]],
    ["-blur", "0x0", [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]],
    ["-gaussian-blur", "0x0", [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]]
] as const)(`matches native %s %s (retained=${retained}, vertical=${vertical})`, async (operator, geometry, expected) => {
    const input = await sharp(Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), {
        raw: { width: vertical ? 1 : 3, height: vertical ? 3 : 1, channels: 4 }
    }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", operator, geometry, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data)).toEqual(expected);
});

for (const retained of [false, true])
it.each([
    ["-blur", [15, 24, 15, 24, 38, 24, 15, 24, 15]],
    ["-gaussian-blur", [15, 25, 15, 25, 41, 25, 15, 25, 15]]
] as const)(`matches native two-dimensional %s impulse (retained=${retained})`, async (operator, expected) => {
    const pixels = Uint8Array.from({ length: 36 }, (_, i) => i % 4 === 3 || Math.floor(i / 4) === 4 ? 255 : 0);
    const input = await sharp(pixels, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", operator, "0x1", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data)).toEqual(expected.flatMap(value => [value, value, value, 255]));
});

it.each(["-blur", "-gaussian-blur"])("retains bounded reads and matching pixels across row chunks for %s", async operator => {
    const input = await sharp(Uint8Array.from({ length: 1031 * 3 * 4 }, (_, i) => i % 4 === 3 ? 255 : i * 37 % 256), {
        raw: { width: 1031, height: 3, channels: 4 }
    }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file blur I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const args = ["input.png", operator, "0x1", "out.png"];
    expect((await runConvertCli(args, files)).exitCode).toBe(0);
    expect((await runConvertCli(args, { filesystem, cwd: "/" })).exitCode).toBe(0);
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
