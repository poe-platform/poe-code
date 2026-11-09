import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";
import fixtures from "./exr-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2 Q16-HDRI: linear .25/.5 become 137/188 in sRGB.
for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const fixture of ["none-half", "zip-float"] as const) {
        it.each([
            { spaces: [], greens: [64, 128] },
            { spaces: ["RGB"], greens: [64, 128] },
            { spaces: ["sRGB"], greens: [137, 188] },
            { spaces: ["RGB", "sRGB", "sRGB"], greens: [137, 188] },
            { spaces: ["sRGB", "RGB"], greens: [64, 128] },
        ])(`converts linear EXR ${fixture} in ${mode}: $spaces`, async ({ spaces, greens }) => {
            const bytes = new Uint8Array(Buffer.from(fixtures[fixture], "base64"));
            const files = new Map([["/in.exr", bytes]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.exr", bytes);
            const args = ["/in.exr", ...spaces.flatMap(space => ["-colorspace", space]), "PNG32:/out.png"];
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const png = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([png.width, png.height]).toEqual([2, 18]);
            expect([...png.data]).toEqual(Array.from({ length: 18 }, () => [255, greens[0], 0, 255, 0, greens[1], 255, 255]).flat());
        });
    }
}
