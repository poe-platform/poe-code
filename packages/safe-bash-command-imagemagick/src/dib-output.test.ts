import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick standalone DIB: 40-byte header, bottom-up BGR rows padded to four bytes.
const expected = Buffer.from("2800000003000000020000000100180000000000180000000000000000000000000000000000000000eeff7711998453240000000000ff00ff00ff0000000000", "hex");
const rgb = Buffer.from("ff000000ff000000ffffee00991177245384", "hex");
const input = encodeImage({ width: 3, height: 2, format: "png", hasAlpha: false, space: "srgb", channels: 3, depth: "uchar", density: 72,
    data: Uint8Array.from(Array.from({ length: 6 }, (_, i) => [...rgb.subarray(i * 3, i * 3 + 3), 255]).flat()) }, { format: "png" }).data;

it.each(["sync", "buffered", "retained"] as const)("writes standalone DIB with original RGB pixels (%s)", async mode => {
    for (const target of ["out.dib", "DIB:out.bin"]) for (const write of [false, true]) {
        const files = new Map<string, Uint8Array>([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", ...(write ? ["-write", target, "null:"] : [target])];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const path = target.includes(":") ? "out.bin" : target;
        const bytes = mode === "retained" ? await filesystem.readFile(`/${path}`) : files.get(path)!;
        expect(Buffer.from(bytes)).toEqual(expected);
    }
});

it("keeps the ordinary BMP file header", () => {
    const files = new Map<string, Uint8Array>([["in.png", input]]);
    expect(runConvertCliSync(["in.png", "out.bmp"], files)).toMatchObject({ exitCode: 0 });
    expect([...files.get("out.bmp")!.subarray(0, 2)]).toEqual([0x42, 0x4d]);
});
