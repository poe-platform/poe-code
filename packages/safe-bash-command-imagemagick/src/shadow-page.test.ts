import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Saved PNG geometry verified with ImageMagick 7.1.2-31 Q16-HDRI.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["-9-8", 4294967292, 4294967292, -9, -8],
        ["-9-1", 4294967292, 3, -9, -1],
        ["-2-1", 3, 3, -2, -1],
        ["-5-4", 5, 4, -5, -4],
    ] as const)(`preserves saved shadow page dimensions for %s (${mode})`, async (offset, width, height, x, y) => {
        const data = new Uint8Array(5 * 4 * 4);
        for (let row = 1; row <= 2; row++) for (let col = 1; col <= 3; col++) {
            data[(row * 5 + col) * 4] = 255;
            data[(row * 5 + col) * 4 + 3] = 255;
        }
        const input = encodeImage({ width: 5, height: 4, data, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const backend = mode === "retained" ? { filesystem, cwd: "/" } : files;
        const args = ["/input.png", "-background", "blue", "-shadow", `60x0${offset}`, "/shadow.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, backend);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/shadow.png") : files.get("/shadow.png")!);
        expect([output.width, output.height, output.data.length]).toEqual([5, 4, 80]);
        expect(output.virtualCanvas).toEqual({ width, height, x, y });
        for (let pixel = 0; pixel < 20; pixel++) {
            expect([...output.data.slice(pixel * 4, pixel * 4 + 4)]).toEqual([0, 0, 255, data[pixel * 4 + 3] ? 153 : 0]);
        }
        const identify = await runMagickCli(["identify", "-format", "%wx%h %g", "/shadow.png"], backend);
        expect(identify.stdout).toBe(`5x4 ${width || 5}x${height || 4}${offset}`);
        const repage = await runMagickCli(["/shadow.png", "+repage", "/reset.png"], backend);
        expect(repage.exitCode, repage.stderr).toBe(0);
        expect((await runMagickCli(["identify", "-format", "%g", "/reset.png"], backend)).stdout).toBe("5x4+0+0");
    });
}
