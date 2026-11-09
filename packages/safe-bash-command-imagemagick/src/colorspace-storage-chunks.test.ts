import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand } from "./index.js";

for (const [width, height] of [[512, 1], [513, 1], [64, 32]] as const) {
    for (const space of ["HSL", "HSB", "HWB"]) {
        for (const explicitSrgb of [false, true]) {
            it(`preserves ${width}x${height} pixels through stored ${space}, explicit sRGB=${explicitSrgb}`, async () => {
                const pixels = new Uint8Array(width * height * 4);
                for (let offset = 0; offset < pixels.length; offset += 4) {
                    const pixel = offset / 4;
                    pixels.set([pixel % 256, (pixel * 7) % 256, (pixel * 13) % 256, 255], offset);
                }
                const { data } = encodeImage({ width, height, data: pixels, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" });
                const fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", data);
                const args = ["in.png", "-colorspace", space, ...(explicitSrgb ? ["-colorspace", "sRGB"] : []), "PNG32:out.png"];
                let stderr = "";
                const result = await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async () => {} },
                    stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
                });
                expect(result.exitCode, stderr).toBe(0);
                const decoded = decodeImage(await fs.readFile("/out.png"));
                expect([decoded.width, decoded.height]).toEqual([width, height]);
                expect(decoded.data).toEqual(pixels);
            });
        }
    }
}
