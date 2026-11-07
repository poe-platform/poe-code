import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const)
for (const depth of [8, 16] as const)
for (const alpha of [128, 255])
for (const option of ["-raise", "+raise"])
it(`shades source alpha with ${option}, ${depth}-bit, alpha ${alpha}, ${mode}`, async () => {
    const data = Uint8Array.from(Array.from({ length: 120 }, () => [64, 96, 128, alpha]).flat());
    const input = encodeImage({ width: 12, height: 10, data,
        ...(depth === 16 ? { data16: Uint16Array.from(data, value => value * 257) } : {}),
        format: "png", space: "srgb", channels: 4, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", option, "2", "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const bytes = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    const output = decodeImage(bytes), pixels = depth === 16 ? output.data16! : output.data;
    expect(Array.from(pixels.slice(0, 4))).toEqual(depth === 16
        ? option === "-raise" ? [39548, 43902, 48256, alpha === 128 ? 48256 : 65535] : [8708, 13062, 17416, alpha === 128 ? 17416 : 34695]
        : option === "-raise" ? [154, 171, 188, alpha === 128 ? 188 : 255] : [34, 51, 68, alpha === 128 ? 68 : 135]);
    expect(Array.from(pixels.slice(260, 264))).toEqual(depth === 16 ? [16448, 24672, 32896, alpha * 257] : [64, 96, 128, alpha]);
    if (alpha === 128) expect(Array.from({ length: 120 }, (_, i) => pixels[i * 4 + 3]).filter(alpha => alpha !== (depth === 16 ? 32896 : 128))).toHaveLength(72);
    if (spawnSync("magick", ["-version"]).status === 0) {
        const reference = spawnSync("magick", ["png:-", option, "2", "-depth", String(depth), "rgba:-"], { input });
        const actual = spawnSync("magick", ["png:-", "-depth", String(depth), "rgba:-"], { input: bytes });
        expect(reference.status).toBe(0);
        expect(actual.status).toBe(0);
        expect(actual.stdout.equals(reference.stdout)).toBe(true);
    }
});
