import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: packed red/blue pixels and distinct RGB masks.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.bmp"]) {
        it.each([
            { name: "RGB565", options: ["-define", "bmp:subtype=RGB565"], depth: 16, masks: [0xf800, 0x07e0, 0x001f, 0], pixels: "00f81f00" },
            { name: "RGB555", options: ["-define", "bmp:subtype=rgb555"], depth: 16, masks: [0x7c00, 0x03e0, 0x001f, 0], pixels: "007c1f00" },
            { name: "default", options: [], depth: 24, masks: undefined, pixels: "0000ffff00000000" },
            { name: "reset", options: ["-define", "bmp:subtype=RGB565", "+define", "bmp:subtype"], depth: 24, masks: undefined, pixels: "0000ffff00000000" }
        ])(`${mode} ${destination}: writes $name BMP montage`, async ({ options, depth, masks, pixels }) => {
            const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", ...options, `bmp:${destination}`];
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
            expect(header.getUint32(14, true)).toBe(124);
            expect(header.getUint32(2, true)).toBe(output.length);
            expect([header.getInt32(18, true), header.getInt32(22, true)]).toEqual([2, 1]);
            expect(header.getUint16(28, true)).toBe(depth);
            expect(header.getUint32(30, true)).toBe(depth === 16 ? 3 : 0);
            expect([header.getInt32(38, true), header.getInt32(42, true)]).toEqual([0, 0]);
            if (masks) expect([54, 58, 62, 66].map(offset => header.getUint32(offset, true))).toEqual(masks);
            expect(Buffer.from(output.subarray(header.getUint32(10, true))).toString("hex")).toBe(pixels);
            expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe("ff0000ff0000ffff");
        });
    }
}
