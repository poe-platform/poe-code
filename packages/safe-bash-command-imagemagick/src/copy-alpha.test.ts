import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const)
for (const operator of ["CopyAlpha", "CopyOpacity"])
it.each([
    { name: "grayscale mask", space: "b-w" as const, channels: 1 as const, hasAlpha: false, pixels: [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255], alpha: [0, 128, 255] },
    { name: "RGB intensity", space: "srgb" as const, channels: 3 as const, hasAlpha: false, pixels: [20, 80, 180, 255, 151, 70, 40, 255, 200, 50, 10, 255], alpha: [74, 85, 79] },
    { name: "RGBA alpha", space: "srgb" as const, channels: 4 as const, hasAlpha: true, pixels: [20, 80, 180, 255, 151, 70, 40, 127, 200, 50, 10, 64], alpha: [255, 127, 64] },
    { name: "opaque RGBA alpha", space: "srgb" as const, channels: 4 as const, hasAlpha: true, pixels: [20, 80, 180, 255, 151, 70, 40, 255, 200, 50, 10, 255], alpha: [255, 255, 255] }
])(`${operator} uses $name via ${mode}`, async ({ space, channels, hasAlpha, pixels, alpha }) => {
    const destination = [20, 80, 180, 255, 150, 70, 40, 127, 40, 160, 80, 255];
    const metadata = { width: 3, height: 1, format: "png" as const, depth: "uchar" as const, density: 72 };
    const files = new Map([
        ["dst.png", encodeImage({ ...metadata, space: "srgb", channels: 4 as const, hasAlpha: true, data: Uint8Array.from(destination) }, { format: "png" }).data],
        ["src.png", encodeImage({ ...metadata, space, channels, hasAlpha, data: Uint8Array.from(pixels) }, { format: "png" }).data]
    ]);
    expect(decodeImage(files.get("src.png")!).hasAlpha).toBe(hasAlpha);
    const filesystem = new MemoryFileSystem();
    for (const [name, bytes] of files) await filesystem.writeFile("/" + name, bytes);
    const args = ["dst.png", "src.png", "-compose", operator, "-composite", "out.png"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    expect(Array.from(output.data)).toEqual(destination.map((value, i) => i % 4 === 3 ? alpha[Math.floor(i / 4)] : value));
});
