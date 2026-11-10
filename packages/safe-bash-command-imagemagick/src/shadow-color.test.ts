import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([0, 1])(`preserves colored shadows of grayscale PNGs at sigma %s (${mode})`, async sigma => {
        const input = encodeImage({ width: 2, height: 2, data: Uint8Array.from(Array(4).fill([128, 128, 128, 255]).flat()),
            format: "png", space: "b-w", channels: 1, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
        expect(decodeImage(input).space).toBe("b-w");
        const files = new Map([["/gray.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/gray.png", input);
        const args = ["/gray.png", "-background", "red", "-shadow", `100x${sigma}+0+0`, "/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([2 + 4 * sigma, 2 + 4 * sigma]);
        expect(output.virtualCanvas ?? { width: output.width, height: output.height, x: 0, y: 0 }).toEqual({ width: 2 + 2 * sigma, height: 2 + 2 * sigma, x: 0 - 2 * sigma, y: 0 - 2 * sigma });
        for (let offset = 0; offset < output.data.length; offset += 4) {
            expect(Array.from(output.data.subarray(offset, offset + 3))).toEqual([255, 0, 0]);
            if (sigma === 0) expect(output.data[offset + 3]).toBe(255);
        }
    });
}
