import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.ico"]) {
        it.each([
            { name: "descending sizes", options: ["-define", "icon:auto-resize=32,16"], dimensions: [[32, 32], [16, 16]] },
            { name: "ascending sizes", options: ["-define", "icon:auto-resize=16,32"], dimensions: [[16, 16], [32, 32]] },
            { name: "unchanged sheet", options: [], dimensions: [[32, 16]] },
            { name: "removed define", options: ["-define", "icon:auto-resize=32,16", "+define", "icon:auto-resize"], dimensions: [[32, 16]] }
        ])(`${mode} ${destination}: writes $name in one ICO directory`, async ({ options, dimensions }) => {
            const args = ["-size", "16x16", "xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", ...options, `ico:${destination}`];
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
            expect([...output.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
            expect(directory.getUint16(4, true)).toBe(dimensions.length);
            let end = 6 + dimensions.length * 16;
            for (const [index, [width, height]] of dimensions.entries()) {
                const entry = 6 + index * 16;
                expect([...output.subarray(entry, entry + 2)]).toEqual([width, height]);
                expect(directory.getUint32(entry + 12, true)).toBe(end);
                end += directory.getUint32(entry + 8, true);
                expect(end).toBeLessThanOrEqual(output.length);
                const image = decodeImage(output, { page: index });
                expect([image.width, image.height]).toEqual([width, height]);
                const middleRow = Math.floor(image.height / 2) * image.width;
                for (const [x, rgba] of [[0, [255, 0, 0, 255]], [image.width - 1, [0, 0, 255, 255]]] as const) {
                    const pixel = (middleRow + x) * 4;
                    expect([...image.data.subarray(pixel, pixel + 4)]).toEqual(rgba);
                }
            }
            expect(end).toBe(output.length);
        });
    }
}
