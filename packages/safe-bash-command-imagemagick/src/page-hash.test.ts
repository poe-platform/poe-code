import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 keeps the same page and pixels with or without #.
for (const mode of ["sync", "public"] as const) {
    for (const geometry of ["4x3+1+2", "4x3+1+2#"]) {
        it.each([
            ["-page", geometry, "/input.png"],
            ["/input.png", "-repage", geometry],
            ["/input.png", "-set", "page", geometry],
        ])(`preserves ${geometry} page dimensions, offsets and flattened pixels via ${mode}: %j %j %j`, async (...options) => {
            const pixels = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 255, 255, 255, 0, 255]);
            const input = await sharp(pixels, { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
            const keep = new TextEncoder().encode("KEEP");
            for (const destination of ["info", "png", "flatten"]) {
                const files = new Map<string, Uint8Array>([["/input.png", input], ["/out.png", keep]]);
                const filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/input.png", input);
                await filesystem.writeFile("/out.png", keep);
                const args = [...options, ...(destination === "flatten" ? ["-background", "black", "-flatten"] : []),
                    "-format", "%wx%h|%g", destination === "info" ? "info:" : "PNG32:/out.png"];
                let stdout = "", stderr = "", exitCode: number;
                if (mode === "public") {
                    const argumentValues = createCommandArguments(args);
                    const result = await createMagickCommand().execute({
                        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                        signal: new AbortController().signal, stdin: (async function* () {})(),
                        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                    });
                    exitCode = result.exitCode;
                } else {
                    ({ exitCode, stdout, stderr } = runConvertCliSync(args, files));
                }
                expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
                const output = mode === "public" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
                if (destination === "info") {
                    expect(stdout).toBe("3x2|4x3+1+2");
                    expect(output).toEqual(keep);
                } else {
                    const image = decodeImage(output);
                    if (destination === "png") {
                        expect([image.width, image.height]).toEqual([3, 2]);
                        expect(image.virtualCanvas).toEqual({ width: 4, height: 3, x: 1, y: 2 });
                        expect(image.data).toEqual(decodeImage(input).data);
                    } else {
                        expect([image.width, image.height]).toEqual([4, 3]);
                        expect(image.virtualCanvas ?? { width: image.width, height: image.height, x: 0, y: 0 })
                            .toEqual({ width: 4, height: 3, x: 0, y: 0 });
                        expect(image.data).toEqual(Uint8Array.from([
                            0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
                            0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
                            0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
                        ]));
                    }
                }
            }
        });
    }
}
