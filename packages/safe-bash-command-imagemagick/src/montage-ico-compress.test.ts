import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI keeps 32-bit DIB entries even with Zip compression.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.ico"]) {
        it.each([
            { size: 32, options: ["-compress", "Zip"] },
            { size: 256, options: ["-compress", "Zip"] },
            { size: 32, options: ["-compress", "None"] },
            { size: 32, options: ["-compress", "zIp"] },
            { size: 32, options: ["-compress", "Zip", "+compress"] }
        ])(`${mode} ${destination}: writes a $size pixel DIB icon with $options`, async ({ size, options }) => {
            const args = ["-size", `${size}x${size}`, "xc:red", "-tile", "1x1", "-geometry", "+0+0", ...options, `ico:${destination}`];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
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
                output = destination === "-" ? Buffer.concat(chunks) : await fs.readFile(destination);
            } else {
                const result = mode === "sync" ? runMontageCliSync(args, files)
                    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
                expect(result).toMatchObject({ exitCode: 0, stderr: "" });
                output = destination === "-" ? result.stdoutBytes! : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
            }
            const directory = new DataView(output.buffer, output.byteOffset, output.byteLength);
            expect([...output.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
            expect([...output.subarray(6, 10)]).toEqual([size % 256, size % 256, 0, 0]);
            expect(directory.getUint16(10, true)).toBe(1);
            expect(directory.getUint16(12, true)).toBe(32);
            const length = directory.getUint32(14, true), offset = directory.getUint32(18, true);
            expect(offset).toBe(22);
            expect(length).toBe(40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
            expect(offset + length).toBe(output.length);
            expect(directory.getUint32(offset, true)).toBe(40);
            expect(directory.getInt32(offset + 4, true)).toBe(size);
            expect(directory.getInt32(offset + 8, true)).toBe(size * 2);
            expect(directory.getUint16(offset + 12, true)).toBe(1);
            expect(directory.getUint16(offset + 14, true)).toBe(32);
            expect(directory.getUint32(offset + 16, true)).toBe(0);
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([size, size]);
            for (const x of [0, size - 1]) {
                const pixel = (Math.floor(size / 2) * size + x) * 4;
                expect([...image.data.subarray(pixel, pixel + 4)]).toEqual([255, 0, 0, 255]);
            }
        });
    }
}
