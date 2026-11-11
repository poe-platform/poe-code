import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        [[], 256, 200],
        [["-size", "128x75"], 256, 200],
        [["-density", "128x75"], 128, 75],
        [["-density", "512x75"], 512, 75],
    ] as const)(`sizes histogram rasters and INFO from density (retained=${retained}, options=%j)`, async (options, width, height) => {
        const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0]);
        const ppm = Buffer.concat([Buffer.from("P6\n4 2\n255\n"), pixels]);
        const files = new Map<string, Uint8Array>([["in.ppm", ppm]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.ppm", ppm);
        const input = retained ? { filesystem, cwd: "/" } : files;
        expect(await runConvertCli(["in.ppm", ...options, "-format", "%wx%h", "histogram:info:"], input))
            .toEqual({ exitCode: 0, stderr: "", stdout: `${width}x${height}` });
        for (const format of ["png", "miff"]) {
            const name = `out.${format}`;
            expect(await runConvertCli(["in.ppm", ...options, `histogram:${name}`], input))
                .toEqual({ exitCode: 0, stderr: "", stdout: "" });
            const bytes = retained ? await filesystem.readFile(`/${name}`) : files.get(name)!;
            const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
            expect([info.width, info.height, info.channels, data.length]).toEqual([width, height, 3, width * height * 3]);
            if (options[0] === "-density") {
                // Decoded RGB hashes from native ImageMagick 7.
                expect(createHash("sha256").update(data).digest("hex")).toBe(width === 128
                    ? "f7eb76a4a0975c9b3d51c111323a38a32b6e8dec67319b531d4a0a37c17a21f3"
                    : "46750abba8b8c7a32442a18a6b82e69d3c5cdc4c72a94b13ce603ada15aae4d1");
            }
            // Native keeps the 256 intensity bins at their original x coordinates.
            const bottom = data.subarray((height - 1) * width * 3);
            expect([...bottom.subarray(0, 3)]).toEqual([255, 255, 255]);
            expect([...bottom.subarray(3, 6)]).toEqual([0, 0, 0]);
            if (width > 255) expect([...bottom.subarray(255 * 3, 256 * 3)]).toEqual([255, 255, 255]);
            if (width > 256) expect([...bottom.subarray(256 * 3)]).toEqual(new Array((width - 256) * 3).fill(0));
        }
    });
}
