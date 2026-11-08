import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([0, 60])(`preserves blue beneath transparent blurred shadow pixels at %s percent (${mode})`, async opacity => {
        const data = new Uint8Array(5 * 4 * 4);
        for (let y = 1; y <= 2; y++) for (let x = 1; x <= 3; x++) {
            data[(y * 5 + x) * 4] = 255;
            data[(y * 5 + x) * 4 + 3] = 255;
        }
        const input = encodeImage({ width: 5, height: 4, data, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-background", "blue", "-shadow", `${opacity}x1+4+4`, "/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([9, 8]);
        expect(output.virtualCanvas).toEqual({ width: 11, height: 10, x: 2, y: 2 });
        const alphas: number[] = [];
        for (let offset = 0; offset < output.data.length; offset += 4) {
            expect([...output.data.slice(offset, offset + 3)]).toEqual([0, 0, 255]);
            alphas.push(output.data[offset + 3]!);
        }
        expect(alphas).toContain(0);
        expect(Math.max(...alphas)).toBe(opacity === 0 ? 0 : 83);
    });
}
