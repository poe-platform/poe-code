import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "stored", "sync"] as const)
for (const vertical of [false, true])
for (const [filter, size, expected] of [
    ["Box", 3, [32, 96, 32]],
    ["Box", 4, [32, 96, 32, 32]],
    ["Box", 6, [32, 32, 128, 32, 32, 32]],
    ["Point", 3, [32, 224, 32]],
    ["Box", 27, Array.from({ length: 27 }, (_, i) => i >= 12 && i < 15 ? 224 : 32)]
] as const) {
    it(`${mode}: ${filter} impulse resize to ${size}, vertical=${vertical}`, async () => {
        const input = await sharp(Uint8Array.from([32, 32, 32, 32, 224, 32, 32, 32, 32]), {
            raw: { width: vertical ? 1 : 9, height: vertical ? 9 : 1, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-filter", filter, "-resize", vertical ? `1x${size}!` : `${size}x1!`, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "stored" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "stored" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual(vertical ? [1, size] : [size, 1]);
        // ImageMagick 7 Box averages the covered source pixels; Point selects one.
        expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}
