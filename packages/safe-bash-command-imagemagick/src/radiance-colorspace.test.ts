import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: linear .25/.5 become 137/188 in sRGB.
for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([
        { spaces: [], greens: [64, 128] },
        { spaces: ["RGB"], greens: [64, 128] },
        { spaces: ["sRGB"], greens: [137, 188] },
        { spaces: ["RGB", "sRGB", "sRGB"], greens: [137, 188] },
        { spaces: ["sRGB", "RGB"], greens: [64, 128] },
    ])(`converts linear Radiance RGBE in ${mode}: $spaces`, async ({ spaces, greens }) => {
        const bytes = new Uint8Array([...new TextEncoder().encode("#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n"), 128, 32, 0, 129, 0, 64, 128, 129]);
        const files = new Map([["/in.hdr", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.hdr", bytes);
        const args = ["/in.hdr", ...spaces.flatMap(space => ["-colorspace", space]), "PNG32:/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const png = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([png.width, png.height]).toEqual([2, 1]);
        expect([...png.data]).toEqual([255, greens[0], 0, 255, 0, greens[1], 255, 255]);
    });
}
