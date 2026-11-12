import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: one Gray plane for both grayscale options.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const format of ["psd", "psb"]) {
        it.each([
            { options: ["-type", "Grayscale"], channels: 1, colorMode: 1, depth: 16, pixels: [0x3670, 0x3670, 0x3670, 65535, 0x127b, 0x127b, 0x127b, 65535] },
            { options: ["-colorspace", "Gray"], channels: 1, colorMode: 1, depth: 16, pixels: [0x3670, 0x3670, 0x3670, 65535, 0x127b, 0x127b, 0x127b, 65535] },
            { options: ["-colorspace", "Gray"], channels: 1, colorMode: 1, depth: 8, pixels: [54, 54, 54, 255, 18, 18, 18, 255] },
            { options: [], channels: 3, colorMode: 3, depth: 16, pixels: [65535, 0, 0, 65535, 0, 0, 65535, 65535] }
        ])(`${mode} ${format}: writes $depth-bit $options composite and layer`, async ({ options, channels, colorMode, depth, pixels }) => {
            const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", "-depth", String(depth), ...options, `${format}:-`];
            const fs = new MemoryFileSystem();
            let output: Uint8Array;
            if (mode === "magick" || mode === "montage") {
                const chunks: Uint8Array[] = [];
                let stderr = "";
                const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
                    command: mode, args: mode === "magick" ? ["montage", ...args] : args,
                    cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(),
                    stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                });
                expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
                output = Buffer.concat(chunks);
            } else {
                const files = new Map<string, Uint8Array>();
                const result = mode === "sync" ? runMontageCliSync(args, files)
                    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                output = result.stdoutBytes!;
            }
            const header = new DataView(output.buffer, output.byteOffset, output.byteLength);
            expect([header.getUint16(12), header.getUint32(14), header.getUint32(18), header.getUint16(22), header.getUint16(24)])
                .toEqual([channels, 1, 2, depth, colorMode]);
            for (const page of [0, 1]) {
                const image = decodeImage(output, { page });
                expect(image).toMatchObject({ channels, space: colorMode === 1 ? "b-w" : "srgb", bitsPerSample: depth, pages: 2 });
                expect(Array.from(depth === 16 ? image.data16! : image.data)).toEqual(pixels);
            }
        });
    }
}
