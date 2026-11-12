import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Header fields and opaque pixels from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.bmp"] as const) {
        it.each([
            { coder: "bmp", options: [], size: 124 },
            { coder: "bmp2", options: [], size: 12 },
            { coder: "bmp3", options: [], size: 40 },
            { coder: "bmp", options: ["-define", "bmp:format=bmp2"], size: 12 },
            { coder: "bmp", options: ["-define", "bmp:format=bmp3"], size: 40 },
            { coder: "bmp", options: ["-define", "bmp:format=bmp4"], size: 124 },
            { coder: "bmp", options: ["-define", "bmp:format=bmp2", "+define", "bmp:format"], size: 124 }
        ])(`${mode} ${destination}: $coder $options writes a $size-byte BMP header`, async ({ coder, options, size }) => {
            const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", ...options, `${coder}:${destination}`];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            let output: Uint8Array;
            if (mode === "magick" || mode === "montage") {
                const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
                const chunks: Uint8Array[] = [], stderr: Uint8Array[] = [];
                const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
                    command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                    stderr: { async write(chunk) { stderr.push(chunk.slice()); } }
                });
                expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: [] });
                output = destination === "-" ? Buffer.concat(chunks) : await fs.readFile(destination);
            } else {
                const result = mode === "sync" ? runMontageCliSync(args, files)
                    : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                output = destination === "-" ? result.stdoutBytes!
                    : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
            }
            const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
            expect(view.getUint32(14, true)).toBe(size);
            expect(view.getUint32(2, true)).toBe(output.length);
            expect(view.getUint32(10, true)).toBe(14 + size);
            expect(view.getUint16(size === 12 ? 24 : 28, true)).toBe(24);
            if (size !== 12) {
                expect(view.getUint32(30, true)).toBe(0);
                expect([view.getInt32(38, true), view.getInt32(42, true)]).toEqual([0, 0]);
            }
            if (size === 124) {
                expect([54, 58, 62, 66].map(offset => view.getUint32(offset, true)))
                    .toEqual([0xff0000, 0xff00, 0xff, 0xff000000]);
            }
            const image = decodeImage(output);
            expect({ width: image.width, height: image.height }).toEqual({ width: 2, height: 1 });
            expect(Array.from(image.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
        });
    }
}
