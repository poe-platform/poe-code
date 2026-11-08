import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

it.each(["buffered", "retained", "sync"] as const)("preserves 16-bit vignette interior RGB (%s)", async mode => {
    const data16 = Uint16Array.from({ length: 20 * 16 * 4 }, (_, i) => [0x3021, 0x6043, 0xa065, 0x8123][i % 4]!);
    const input = encodeImage({ width: 20, height: 16, data16, data: Uint8Array.from(data16, value => Math.round(value / 257)),
        format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
    expect(decodeImage(input).data16).toEqual(data16);
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "-vignette", "0x1+3+2", "/output.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
    expect([output.width, output.height]).toEqual([20, 16]);
    expect(output.data16).toBeDefined();
    // Native ImageMagick Q16-HDRI replaces source alpha but preserves interior RGB.
    expect(Array.from(output.data16!.slice((8 * 20 + 10) * 4, (8 * 20 + 11) * 4))).toEqual([0x3021, 0x6043, 0xa065, 0xffff]);
});
