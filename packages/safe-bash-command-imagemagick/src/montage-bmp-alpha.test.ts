import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference headers and decoded RGBA pixels.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.bmp"]) {
        it.each([
            { coder: "bmp", colors: ["#33669980", "none", "blue"], transparent: true, dib: 124, depth: 32, compression: 3, hex: "33669980000000000000ffff" },
            { coder: "bmp3", colors: ["#33669980", "none", "blue"], transparent: true, dib: 40, depth: 24, compression: 0, hex: "336699ff000000ff0000ffff" },
            { coder: "bmp", colors: ["red", "blue"], transparent: false, dib: 124, depth: 24, compression: 0, hex: "ff0000ff0000ffff" }
        ])(`${mode} ${destination}: preserves $coder pixels (transparent=$transparent)`, async ({ coder, colors, transparent, dib, depth, compression, hex }) => {
            const target = coder === "bmp" && destination !== "-" ? destination : `${coder}:${destination}`;
            const args = [...colors.map(color => `xc:${color}`), "-tile", `${colors.length}x1`, "-geometry", "+0+0", ...(transparent ? ["-background", "none"] : []), target];
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
            const header = new DataView(output.buffer, output.byteOffset, output.byteLength);
            expect([header.getUint32(14, true), header.getUint16(28, true), header.getUint32(30, true)]).toEqual([dib, depth, compression]);
            expect([header.getInt32(38, true), header.getInt32(42, true)]).toEqual([0, 0]);
            if (depth === 32) expect([54, 58, 62, 66].map(offset => header.getUint32(offset, true))).toEqual([0xff0000, 0xff00, 0xff, 0xff000000]);
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([colors.length, 1]);
            expect(Buffer.from(image.data).toString("hex")).toBe(hex);
        });
    }
}
