import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const depth of [8, 16]) {
    it.each(["buffered", "retained", "sync"] as const)(`rejects negative vignette radii but accepts zero at ${depth} bits (%s)`, async mode => {
        const data16 = Uint16Array.from({ length: 20 * 16 * 4 }, (_, i) => [0x3021, 0x6043, 0xa065, 0x8080][i % 4]!);
        const input = encodeImage({ width: 20, height: 16, data: Uint8Array.from(data16, value => Math.round(value / 257)),
            ...(depth === 16 ? { data16 } : {}), format: "png", space: "srgb", channels: 4,
            depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        // Native ImageMagick rejects either negative radius, including percentage insets.
        for (const [geometry, invalid] of [
            ["0x0+15+10", true], ["0x0+11+8", true], ["0x0+10+9", true],
            ["0x0+55+50%", true], ["0x0+50+56%", true],
            ["0x0+10+8", false], ["0x0+10+0", false], ["0x0+50+50%", false]
        ] as const) {
            for (const existing of [false, true]) {
                const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.png", input);
                if (existing) {
                    files.set("/output.png", input);
                    await filesystem.writeFile("/output.png", input);
                }
                const args = ["/input.png", "-vignette", geometry, "/output.png"];
                const result = mode === "sync" ? runMagickCliSync(args, files)
                    : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect(result.exitCode, geometry + result.stderr).toBe(invalid ? 1 : 0);
                if (invalid) {
                    expect(result.stderr).toContain("non-conforming drawing primitive definition 'ellipse'");
                    if (existing) expect(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")).toEqual(input);
                    else {
                        expect(files.has("/output.png")).toBe(false);
                        await expect(filesystem.readFile("/output.png")).rejects.toMatchObject({ code: "ENOENT" });
                    }
                } else {
                    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
                    expect([output.width, output.height]).toEqual([20, 16]);
                    expect(output.data).toEqual(new Uint8Array(20 * 16 * 4).fill(255));
                    if (depth === 16) expect(output.data16).toEqual(new Uint16Array(20 * 16 * 4).fill(65535));
                }
            }
        }
    });
}
