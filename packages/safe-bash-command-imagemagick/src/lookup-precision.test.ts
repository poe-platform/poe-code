import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true])
for (const operation of ["-clut", "-hald-clut"])
for (const selected of ["RGB", "R"])
for (const inverted of [false, true])
it(`preserves lookup precision: ${operation}, ${selected}, inverted=${inverted}, retained=${retained}`, async () => {
    const samples = Uint16Array.of(0x4023, 0x8034, 0xc045, 0x9876);
    const base = encodeImage({ width: 1, height: 1, data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: samples,
        format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
    const hald = operation === "-hald-clut";
    const lookup = Uint8Array.from({ length: hald ? 256 : 8 }, (_, offset) => {
        const channel = offset % 4, pixel = Math.floor(offset / 4);
        if (channel === 3) return 255;
        const value = hald ? Math.floor(pixel / 4 ** channel) % 4 * 85 : pixel * 255;
        return inverted ? 255 - value : value;
    });
    const lut = encodeImage({ width: hald ? 8 : 2, height: hald ? 8 : 1, data: lookup,
        format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
    const files = new Map([["base.png", base], ["lut.png", lut]]), fs = new MemoryFileSystem();
    for (const [path, data] of files) await fs.writeFile(`/${path}`, data);
    expect(await runConvertCli(["base.png", "lut.png", "-channel", selected, operation, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data16 ?? Uint16Array.from(output.data, value => value * 257)))
        .toEqual(Array.from(samples, (value, channel) => inverted && channel < (selected === "R" ? 1 : 3) ? 65535 - value : value));
});

for (const retained of [false, true])
for (const operation of ["-clut", "-hald-clut"])
it(`preserves 16-bit lookup entries for an 8-bit source: ${operation}, retained=${retained}`, async () => {
    const metadata = { width: 1, height: 1, format: "png" as const, space: "srgb" as const, channels: 4 as const, density: 72, hasAlpha: true };
    const base = encodeImage({ ...metadata, depth: "uchar", data: Uint8Array.of(64, 128, 192, 255) }, { format: "png" }).data;
    const samples = Uint16Array.of(0x1234, 0x5678, 0x9abc, 0xffff);
    const lut = encodeImage({ ...metadata, depth: "ushort", data16: samples, data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
    const files = new Map([["base.png", base], ["lut.png", lut]]), fs = new MemoryFileSystem();
    for (const [path, data] of files) await fs.writeFile(`/${path}`, data);
    expect(await runConvertCli(["base.png", "lut.png", "-channel", "R", operation, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data16 ?? Uint16Array.from(output.data, value => value * 257))).toEqual([0x1234, 0x8080, 0xc0c0, 0xffff]);
});
