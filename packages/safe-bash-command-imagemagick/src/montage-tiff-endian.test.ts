import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Headers and RGBA samples verified against ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const columns of [1, 2])
    for (const destination of ["-", "/sheet.tif"] as const) {
        it.each([
            { options: [], header: "49492a00" },
            { options: ["-endian", "LSB"], header: "49492a00" },
            { options: ["-endian", "MSB"], header: "4d4d002a" }
        ])(`${mode} ${destination} ${columns} columns: writes readable montage TIFF with $options`, async ({ options, header }) => {
            const args = ["xc:red", "xc:blue", "-tile", `${columns}x1`, "-geometry", "+0+0", "-depth", "8", ...options, `tiff:${destination}`];
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
            expect(Buffer.from(output.subarray(0, 4)).toString("hex")).toBe(header);
            for (let page = 0; page < 2 / columns; page++) {
                const image = decodeImage(output, { page });
                expect({ width: image.width, height: image.height }).toEqual({ width: columns, height: 1 });
                expect(image.pages ?? 1).toBe(2 / columns);
                expect(Buffer.from(image.data).toString("hex")).toBe(
                    columns === 2 ? "ff0000ff0000ffff" : page === 0 ? "ff0000ff" : "0000ffff"
                );
            }
        });
    }
}
