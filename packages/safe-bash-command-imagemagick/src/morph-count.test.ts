import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["map", "sync", "filesystem"])
for (const [count, middle] of [
    ["0", []],
    ["0.9", []],
    ["1.5", [128, 0, 128, 255]],
    ["2", [170, 0, 85, 255, 85, 0, 170, 255]]
] as const)
it(`matches native morph frame counts and pixels: ${mode}, count=${count}`, async () => {
    const red = await sharp(Uint8Array.of(255, 0, 0, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const blue = await sharp(Uint8Array.of(0, 0, 255, 255), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["/red.png", red], ["/blue.png", blue]]), fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/red.png", "/blue.png", "-morph", count, "+append", "/out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "filesystem" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    // ImageMagick 7.1.2 Q16-HDRI truncates the count before interpolating.
    expect([output.width, output.height]).toEqual([2 + middle.length / 4, 1]);
    expect([...output.data]).toEqual([255, 0, 0, 255, ...middle, 0, 0, 255, 255]);
});
