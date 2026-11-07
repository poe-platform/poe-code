import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const)
for (const hasAlpha of [false, true])
for (const depth of ["uchar", "ushort"] as const)
it(`${mode}: CLUT alpha selection respects source alpha (alpha=${hasAlpha}, depth=${depth})`, async () => {
    const metadata = { format: "png" as const, space: "srgb" as const, depth, density: 72 };
    const base = encodeImage({ ...metadata, width: 1, height: 1, channels: hasAlpha ? 4 : 3, hasAlpha,
        data: Uint8Array.of(64, 128, 192, hasAlpha ? 128 : 255),
        ...(depth === "ushort" ? { data16: Uint16Array.of(64, 128, 192, hasAlpha ? 128 : 255).map(value => value * 257) } : {}) }, { format: "png" }).data;
    const lut = encodeImage({ ...metadata, width: 2, height: 1, channels: 4, hasAlpha: true,
        data: Uint8Array.of(255, 0, 0, 64, 0, 0, 255, 64),
        ...(depth === "ushort" ? { data16: Uint16Array.of(255, 0, 0, 64, 0, 0, 255, 64).map(value => value * 257) } : {}) }, { format: "png" }).data;
    const files = new Map([["/base.png", base], ["/lut.png", lut]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, data] of files) await filesystem.writeFile(path, data);
    const args = ["/base.png", "/lut.png", "-channel", "A", "-clut", "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data]).toEqual([64, 128, 192, hasAlpha ? 64 : 255]);
});
