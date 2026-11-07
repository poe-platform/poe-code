import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-31 Q16-HDRI, full grayscale rows for enlargement and edge reduction.
import fixtures from "./resize-special-fixtures.json" with { type: "json" };

for (const { filter, target, impulse, expected } of fixtures) for (const vertical of [false, true]) {
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it(`matches the complete native ${filter} impulse to ${target}: ${mode}, vertical=${vertical}`, async () => {
            const pixels = Uint8Array.from(Array.from({ length: 9 }, (_, i) => Array(3).fill(i === impulse ? 224 : 32)).flat());
            const input = await sharp(pixels, { raw: { width: vertical ? 1 : 9, height: vertical ? 9 : 1, channels: 3 } }).png().toBuffer();
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["png:-", "-filter", filter, "-resize", vertical ? `1x${target}!` : `${target}x1!`, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files, input)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files, input);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
        });
    }
}
