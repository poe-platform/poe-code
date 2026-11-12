import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 omits ResolutionInfo by default, for both composite and layer.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.psd"] as const) {
        it.each([
            { name: "default", options: [], resolution: undefined },
            { name: "explicit PPI", options: ["-units", "PixelsPerInch", "-density", "90x120"], resolution: { x: 90, y: 120, unit: "inch" } },
            { name: "density without units", options: ["-density", "90x120"], resolution: { x: 90, y: 120, unit: "inch" } }
        ])(`${mode} ${destination}: preserves $name PSD resolution`, async ({ options, resolution }) => {
            const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", ...options, `psd:${destination}`];
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
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
            const bytes = Buffer.from(output);
            expect(bytes.readUInt32BE(30)).toBe(resolution ? 28 : 0);
            for (const page of [0, 1]) {
                const image = decodeImage(bytes, { page });
                expect(image.resolution).toEqual(resolution);
                expect(image.density).toBe(resolution?.x ?? 72);
                expect(image).toMatchObject({ width: 2, height: 1, pages: 2 });
                expect(Array.from(image.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
            }
        });
    }
}
