import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const depth of [8, 16]) {
    it.each(["buffered", "retained", "sync"] as const)(`defaults an omitted vertical vignette inset at ${depth} bits (%s)`, async mode => {
        const data16 = Uint16Array.from({ length: 20 * 16 * 4 }, (_, i) => [0x3021, 0x6043, 0xa065, 0x8080][i % 4]!);
        const input = encodeImage({ width: 20, height: 16, data: Uint8Array.from(data16, value => Math.round(value / 257)),
            ...(depth === 16 ? { data16 } : {}), format: "png", space: "srgb", channels: 4,
            depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const outputs = [];
        // Native ImageMagick 7.1.2 defaults Y to 10% of image height, rounded to 2 here.
        for (const geometry of ["0x1+4", "0x1+4+2", "0x1+4+0"]) {
            const args = ["/input.png", "-vignette", geometry, "/output.png"];
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
            if (depth === 16) expect(output.data16).toBeDefined();
            outputs.push(depth === 16 ? output.data16 : output.data);
        }
        expect(outputs[0]).toEqual(outputs[1]);
        expect(outputs[0]).not.toEqual(outputs[2]);
    });
}
