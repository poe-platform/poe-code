import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

it.each(["sync", "buffered", "retained"] as const)("writes ICO directories and DIB pixels (%s)", async mode => {
    for (const suffix of ["ico", "cur", "ico:output.bin"]) for (const count of [1, 3]) for (const write of [false, true]) {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const target = suffix.includes(":") ? suffix : `output.${suffix}`;
        const path = target.includes(":") ? "output.bin" : target;
        const args = ["-size", "16x16", "xc:red", ...(count === 3 ? ["-size", "32x32", "xc:lime", "-size", "64x64", "xc:blue"] : []), ...(write ? ["-write", target, "null:"] : [target])];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "retained" ? await filesystem.readFile(`/${path}`) : files.get(path);
        expect(bytes).toBeDefined();
        const view = new DataView(bytes!.buffer, bytes!.byteOffset, bytes!.byteLength);
        expect([...bytes!.slice(0, 6)]).toEqual([0, 0, 1, 0, count, 0]);
        let end = 6 + 16 * count;
        for (let i = 0; i < count; i++) {
            const n = [16, 32, 64][i]!, p = 6 + 16 * i;
            expect([bytes![p], bytes![p + 1]]).toEqual([n, n]);
            expect(view.getUint16(p + 4, true)).toBe(1);
            expect(view.getUint16(p + 6, true)).toBe(32);
            expect(view.getUint32(p + 12, true)).toBe(end);
            expect(view.getUint32(end, true)).toBe(40);
            expect(view.getInt32(end + 4, true)).toBe(n);
            expect(view.getInt32(end + 8, true)).toBe(n * 2);
            expect([...bytes!.slice(end + 40, end + 44)]).toEqual([[0,0,255,255], [0,255,0,255], [255,0,0,255]][i]);
            end += view.getUint32(p + 8, true);
        }
        expect(end).toBe(bytes!.length);
    }
});

it.each(["sync", "buffered", "retained"] as const)("preserves alpha, 256 dimensions and explicit scene splitting (%s)", async mode => {
    const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
    const run = (args: string[]) => mode === "sync" ? runConvertCliSync(args, files) : runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
    const read = (path: string) => mode === "retained" ? filesystem.readFile(`/${path}`) : Promise.resolve(files.get(path)!);
    expect(await run(["-size", "256x2", "xc:none", "transparent.ico"])).toMatchObject({ exitCode: 0 });
    const bytes = await read("transparent.ico");
    expect([...bytes.slice(6, 8)]).toEqual([0, 2]);
    expect(bytes[22 + 40 + 3]).toBe(0);
    expect([...bytes.slice(22 + 40 + 256 * 2 * 4)]).toEqual(Array(64).fill(255));
    for (const args of [["+adjoin", "split.ico"], ["scene-%d.ico"]]) {
        expect(await run(["-size", "16x16", "xc:red", "xc:blue", ...args])).toMatchObject({ exitCode: 0 });
        for (const index of [0, 1]) expect([...(await read(`${args.length === 2 ? "split" : "scene"}-${index}.ico`)).slice(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
    }
});

// Pixel values and encoded sizes verified against native ImageMagick.
it.each(["sync", "buffered", "retained"] as const)("writes native indexed ICO depths without changing pixels (%s)", async mode => {
    const tile = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from("ff000000ff000000ffffffff000000227766ff8800442299", "hex")]);
    const reds = [255,247,239,230,222,214,206,197,189,181,173,165,156,148,140,132,123,115,107,99,90,82,74,66,58,49,41,33,25,16,8,0];
    for (const test of [
        { args: ["-size", "32x32", "gradient:red-blue", "-colors", "32", "-type", "Palette"], depth: 8, size: 2238,
          pixels: Uint8Array.from(reds.flatMap(r => Array.from({ length: 32 }, () => [r, 0, 255-r, 255]).flat())) },
        { args: ["tile.ppm", "-colors", "4", "-type", "Palette"], depth: 4, size: 142,
          pixels: Uint8Array.from(Buffer.from("aa8200ff113c33ff2211ccffffffffff113c33ff113c33ffaa8200ff2211ccff", "hex")) },
        { args: ["tile.ppm"], depth: 32, size: 102,
          pixels: Uint8Array.from(Array.from({ length: 8 }, (_, i) => [...tile.subarray(tile.length - 24 + i * 3, tile.length - 21 + i * 3), 255]).flat()) },
    ]) {
        const files = new Map<string, Uint8Array>([["tile.ppm", tile]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/tile.ppm", tile);
        const args = [...test.args, "out.ico"];
        expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "retained" ? await filesystem.readFile("/out.ico") : files.get("out.ico")!;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset = view.getUint32(18, true);
        expect(view.getUint16(12, true)).toBe(test.depth);
        expect(view.getUint16(offset + 14, true)).toBe(test.depth);
        expect(bytes.length).toBe(test.size);
        expect(decodeImage(bytes).data).toEqual(test.pixels);
    }
});
