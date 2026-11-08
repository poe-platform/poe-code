import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const options of [["-transpose"], ["-transverse"], ["-raise", "3"], ["+raise", "2x6"], ["-deskew", "40%"], ["-tile", "2x3"], ...["merge", "flatten", "mosaic"].map(mode => ["-layers", mode])])
it(`retains conversion options ${options.join(" ")}`, async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp(Uint8Array.from({ length: 19 * 13 * 4 }, (_, i) => i * 73 % 256), { raw: { width: 19, height: 13, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    const files = new Map([["input", bytes]]), args = ["input", "+clone", ...options, "out.png"];
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file conversion forbidden"); };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(await runConvertCli(args, files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const outputs = options[0] === "-layers" ? ["out.png"] : ["out-0.png", "out-1.png"];
    for (const output of outputs) {
        expect(decodeImage(await fs.readFile(`/${output}`))).toEqual(decodeImage(files.get(output)!));
    }
});

for (const args of [[], ["--help", "input"], ["input", "--version"], ["input", "-list", "format"], ["input", "-list", "unknown"], ["-unknown", "out.png"], ["-transpose", "out.png"]])
it(`keeps query/missing-input semantics without whole-file I/O: ${args.join(" ")}`, async () => {
    const fs = new MemoryFileSystem(), bytes = Uint8Array.of(1, 2, 3);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file query I/O forbidden"); };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toEqual(await runConvertCli(args, new Map([["input", bytes]])));
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input"]);
});

it.each([true, false])("matches native ImageMagick raised-border pixels with raised=%s", async raised => {
    const fs = new MemoryFileSystem(), source = Uint8Array.from({ length: 36 }, (_, i) => i % 4 === 3 ? 255 : 128), bytes = await sharp(source, { raw: { width: 3, height: 3, channels: 4 } }).removeAlpha().png().toBuffer();
    await fs.writeFile("/input", bytes);
    expect((await runConvertCli(["input", raised ? "-raise" : "+raise", "1x1", "out.png"], { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    const files = new Map([["input", bytes]]);
    expect((await runConvertCli(["input", raised ? "-raise" : "+raise", "1x1", "out.png"], files)).exitCode).toBe(0);
    expect(decodeImage(files.get("out.png")!)).toEqual(decodeImage(await fs.readFile("/out.png")));
    const values = raised ? [188, 188, 188, 160, 128, 95, 160, 68, 95] : [68, 68, 68, 95, 128, 160, 95, 188, 160];
    expect(decodeImage(await fs.readFile("/out.png")).data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 255])));
});

it("preserves wide image transforms across bounded spans", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp(Uint8Array.from({ length: 12001 * 3 * 4 }, (_, i) => i * 73 % 256), { raw: { width: 12001, height: 3, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    const args = ["input", "-raise", "2x1", "-transpose", "+raise", "1", "-transverse", "out.png"], files = new Map([["input", bytes]]);
    expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runConvertCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});

it.each([true, false])("matches native two-pixel bevel corners on RGB with raised=%s", async raised => {
    const source = Uint8Array.from(Array.from({ length: 25 }, () => [20, 100, 220, 255]).flat());
    const bytes = await sharp(source, { raw: { width: 5, height: 5, channels: 4 } }).removeAlpha().png().toBuffer();
    const files = new Map([["input", bytes]]);
    expect((await runConvertCli(["input", raised ? "-raise" : "+raise", "2x2", "out.png"], files)).exitCode).toBe(0);
    // Native ImageMagick 7.1.2: top, left, center, right, and bottom shades.
    const shades = raised
        ? [[131, 173, 236], [80, 140, 229], [20, 100, 220], [15, 75, 164], [11, 53, 116]]
        : [[11, 53, 116], [15, 75, 164], [20, 100, 220], [80, 140, 229], [131, 173, 236]];
    const regions = [0, 0, 0, 0, 0, 1, 0, 0, 0, 3, 1, 1, 2, 3, 3, 1, 1, 4, 3, 3, 1, 4, 4, 4, 3];
    expect(decodeImage(files.get("out.png")!).data).toEqual(Uint8Array.from(regions.flatMap(region => [...shades[region]!, 255])));
});
