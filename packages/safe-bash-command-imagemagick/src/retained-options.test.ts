import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const options of [["-transpose"], ["-transverse"], ["-raise", "3"], ["+raise", "2x7"], ["-raise", "100"], ["-deskew", "40%"], ["-tile", "2x3"], ...["merge", "flatten", "mosaic"].map(mode => ["-layers", mode]), ["-unknown"], ["+unknown"]])
it(`retains conversion options ${options.join(" ")}`, async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp(Uint8Array.from({ length: 19 * 13 * 4 }, (_, i) => i * 73 % 256), { raw: { width: 19, height: 13, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    const files = new Map([["input", bytes]]), args = ["input", "+clone", ...options, "out.png"];
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file conversion forbidden"); };
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toEqual(await runConvertCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
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

it.each([true, false])("matches independent raised-border pixels with raised=%s", async raised => {
    const fs = new MemoryFileSystem(), source = Uint8Array.from({ length: 36 }, (_, i) => i % 4 === 3 ? 127 : 100), bytes = await sharp(source, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    expect((await runConvertCli(["input", raised ? "-raise" : "+raise", "1", "out.png"], { filesystem: fs, cwd: "/" })).exitCode).toBe(0);
    const values = raised ? [140, 140, 140, 140, 100, 60, 140, 60, 60] : [60, 60, 140, 60, 100, 140, 140, 140, 140];
    expect(decodeImage(await fs.readFile("/out.png")).data).toEqual(Uint8Array.from(values.flatMap(value => [value, value, value, 127])));
});

it("preserves wide image transforms across bounded spans", async () => {
    const fs = new MemoryFileSystem(), bytes = await sharp(Uint8Array.from({ length: 12001 * 3 * 4 }, (_, i) => i * 73 % 256), { raw: { width: 12001, height: 3, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    const args = ["input", "-raise", "2", "-transpose", "+raise", "1", "-transverse", "out.png"], files = new Map([["input", bytes]]);
    expect(await runConvertCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runConvertCli(args, files));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
});
