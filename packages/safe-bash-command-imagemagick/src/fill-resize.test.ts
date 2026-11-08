import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7 Q16-HDRI, opaque RGB 6x4 with gray values 10, 20, ..., 240.
for (const [operation, wide, small] of [
    ["-sample", [10, 20, 30, 50, 60, 70, 80, 90, 110, 120, 190, 200, 210, 230, 240], [10, 30, 50, 130, 150, 170]],
    ["-resize", [21, 32, 45, 57, 69, 101, 113, 125, 137, 149, 181, 193, 205, 218, 229], [47, 67, 87, 163, 183, 203]],
    ["-scale", [27, 38, 50, 62, 73, 102, 113, 125, 137, 148, 177, 188, 200, 212, 223], [45, 65, 85, 165, 185, 205]],
    ["-thumbnail", [21, 33, 45, 57, 69, 101, 113, 125, 137, 149, 181, 193, 205, 217, 229], [46, 66, 86, 164, 184, 204]]
] as const) for (const [geometry, width, height, gray] of [
    ["3x^", 5, 3, wide], ["x2^", 3, 2, small], ["3x3^", 5, 3, wide]
] as const) for (const mode of ["public", "sync"] as const) {
    it(`resolves fill dimensions for ${operation} ${geometry}: ${mode}`, async () => {
        const input = await sharp(Uint8Array.from({ length: 72 }, (_, i) => (Math.floor(i / 3) + 1) * 10), {
            raw: { width: 6, height: 4, channels: 3 }
        }).png().toBuffer();
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const files = new Map([["/input.png", input]]);
        const args = ["/input.png", operation, geometry, "/output.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
            signal: new AbortController().signal, fs,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "public" ? await fs.readFile("/output.png") : files.get("/output.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect([...output.data]).toEqual(gray.flatMap(value => [value, value, value, 255]));
    });
}
