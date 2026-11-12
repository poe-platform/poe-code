import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const)
for (const highDepth of [false, true])
for (const [width, height, sourceWidth, sourceHeight] of [[2, 1, 1, 2], [2, 2, 1, 1], [1, 2, 2, 2], [4100, 2, 4097, 1]] as const) {
    it(`combines planes by coordinates (${mode}, 16-bit=${highDepth}, ${width}x${height}/${sourceWidth}x${sourceHeight})`, async () => {
        const scale = highDepth ? 257 : 1;
        const base = Array.from({ length: width * height }, (_, i) => [68 + i % 20, 85 + i % 20, 102 + i % 20, 255]).flat();
        const other = Array.from({ length: sourceWidth * sourceHeight }, (_, i) => [119 + i % 20, 119 + i % 20, 119 + i % 20, 255]).flat();
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        for (const [name, w, h, samples] of [["/base.png", width, height, base], ["/other.png", sourceWidth, sourceHeight, other]] as const) {
            const bytes = encodeImage({ width: w, height: h, data: Uint8Array.from(samples),
                ...(highDepth ? { data16: Uint16Array.from(samples, v => v * scale) } : {}),
                format: "png", space: "srgb", channels: 4, depth: highDepth ? "ushort" : "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
            files.set(name, bytes);
            await filesystem.writeFile(name, bytes);
        }
        const args = ["/base.png", "/other.png", "/base.png", "-combine", "/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        const expected = base.slice();
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 4;
            const intensity = Math.round((0.212656 * base[offset]! + 0.715158 * base[offset + 1]! + 0.072186 * base[offset + 2]!) * scale);
            expected[offset] = expected[offset + 2] = intensity;
            expected[offset + 1] = (x < sourceWidth ? other[(Math.min(y, sourceHeight - 1) * sourceWidth + x) * 4]! : base[offset + 1]!) * scale;
            expected[offset + 3] = 255 * scale;
        }
        expect(Array.from(highDepth ? output.data16! : output.data)).toEqual(expected);
    });
}
