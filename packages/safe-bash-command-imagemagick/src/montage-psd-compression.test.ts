import { inflateSync } from "node:zlib";
import { createCommandArguments } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { runMontageCli, runMontageCliSync, createMagickCommand, createMontageCommand } from "./index.js";

// ImageMagick 7.1.2-35 emits compression 1/2 and the RGB planes ff00, 0000, 00ff.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
    for (const tile of ["2x1", "1x1"]) for (const destination of ["-", "/sheet.psd"]) {
        it.each(["None", "RLE", "Zip", "reset"])(`${mode} ${tile} ${destination}: writes %s PSD compression`, async compression => {
            const args = ["xc:red", "xc:blue", "-tile", tile, "-geometry", "+0+0", "-depth", "8",
                ...compression === "reset" ? ["-compress", "Zip", "+compress"] : ["-compress", compression], `psd:${destination}`];
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
                output = destination === "-" ? result.stdoutBytes! : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
            }
            const bytes = Buffer.from(output);
            expect(bytes.subarray(0, 4).toString()).toBe("8BPS");
            let offset = 26;
            for (let section = 0; section < 3; section++) offset += 4 + bytes.readUInt32BE(offset);
            expect(bytes.readUInt16BE(offset)).toBe(compression === "RLE" ? 1 : compression === "Zip" ? 2 : 0);
            offset += 2;
            const lengths = compression === "RLE" ? [0, 2, 4].map(at => bytes.readUInt16BE(offset + at)) : [];
            offset += lengths.length * 2;
            for (const [channel, expected] of (tile === "2x1" ? ["ff00", "0000", "00ff"] : ["ff", "00", "00"]).entries()) {
                let plane: Buffer;
                if (compression === "Zip") {
                    const result = inflateSync(bytes.subarray(offset), { info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
                    plane = result.buffer;
                    offset += result.engine.bytesWritten;
                } else if (compression === "RLE") {
                    const end = offset + lengths[channel]!, samples: number[] = [];
                    while (offset < end) {
                        const count = bytes[offset++]!;
                        if (count < 128) for (let i = 0; i <= count; i++) samples.push(bytes[offset++]!);
                        else if (count > 128) samples.push(...Array<number>(257 - count).fill(bytes[offset++]!));
                    }
                    plane = Buffer.from(samples);
                } else { const width = tile === "2x1" ? 2 : 1; plane = bytes.subarray(offset, offset + width); offset += width; }
                expect(plane.toString("hex")).toBe(expected);
            }
            expect(offset).toBe(bytes.length);
        });
    }
}
