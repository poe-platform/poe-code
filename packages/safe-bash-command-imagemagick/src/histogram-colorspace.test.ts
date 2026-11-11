import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMagickCliSync } from "./index.js";

// Saved MIFF read back with ImageMagick 7.1.2-35 Q16-HDRI as sRGB, depth 8.
const cases = [
    { colorspace: "sRGB", space: "srgb", channels: 3, hash: "bfb0b0e973bed890479ea6ddac165d9c6eabe52b3e76b2678512b737a5530e5b" },
    { colorspace: "Gray", space: "b-w", channels: 1, hash: "d83d7aa7805da3bff0c8dc557f5b97ce1a5f8d6388357f00f39a45663e965223" },
    { colorspace: "CMYK", space: "cmyk", channels: 4, hash: "0c5cc90b079d0d9c1ded1376357d23a9782a704a83e01731f50ccd162e246492" }
];

for (const repeats of [1, 129]) for (const mode of ["buffered", "retained", "sync", "streamed"] as const) {
    it.each(cases)(`preserves $colorspace in saved histogram plots (${mode}, repeats=${repeats})`, async ({ colorspace, space, channels, hash }) => {
        const source = Buffer.concat([Buffer.from(`P6\n4 ${2 * repeats}\n255\n`), Buffer.from(("ff0000".repeat(4) + "00ff00".repeat(2) + "0000ff000000").repeat(repeats), "hex")]);
        const files = new Map<string, Uint8Array>([["in.ppm", source]]), filesystem = new MemoryFileSystem(), chunks: Uint8Array[] = [];
        await filesystem.writeFile("/in.ppm", source);
        const args = ["in.ppm", "-colorspace", colorspace, mode === "streamed" ? "histogram:miff:-" : "histogram:out.miff"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/", stdout: { async write(bytes) { chunks.push(bytes.slice()); } } });
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = mode === "streamed" ? Buffer.concat(chunks) : mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("out.miff")!;
        const image = decodeImage(bytes);
        expect(image).toMatchObject({ width: 256, height: 200, space, channels, hasAlpha: false, magickColorspace: colorspace });
        const rgb = image.data.filter((_, index) => index % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(hash);
        if (colorspace === "CMYK") {
            const inks = Uint8Array.from(image.hueSamples!, value => Math.round(value * 255));
            expect(createHash("sha256").update(inks).digest("hex")).toBe("76958c7bd94af1ab91ef3f408d8a651b86ecb3b107e018687963c1676dc8f655");
        }
    });
}
