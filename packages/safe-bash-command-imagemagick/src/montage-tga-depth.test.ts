import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Header and displayed RGBA verified with ImageMagick 7.1.2-35 Q16-HDRI and Pillow.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.tga"] as const) {
        it.each([
            { depth: 5, bits: 16, pixels: "31527bff947352ff000000ffffffffff" },
            { depth: 8, bits: 24, pixels: "345678ff987654ff000000ffffffffff" }
        ])(`${mode} ${destination}: writes montage TGA depth $depth`, async ({ depth, bits, pixels }) => {
            const args = ["xc:#345678", "xc:#987654", "xc:black", "xc:white", "-tile", "2x2", "-geometry", "+0+0", "-depth", String(depth), `tga:${destination}`];
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
            expect(output[2]).toBe(2);
            expect([...output.subarray(8, 18)]).toEqual([0, 0, 0, 0, 2, 0, 2, 0, bits, 0x20]);
            expect(output.length).toBe(18 + 4 * bits / 8);
            const image = decodeImage(output);
            expect({ width: image.width, height: image.height }).toEqual({ width: 2, height: 2 });
            expect(Buffer.from(image.data).toString("hex")).toBe(pixels);
        });
    }
}
