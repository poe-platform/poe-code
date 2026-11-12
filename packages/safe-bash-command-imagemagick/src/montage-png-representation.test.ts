import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI headers and big-endian RGBA16 samples.
for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.png"]) {
        it.each<{ colors: string[]; options: string[]; depth: number; type: number; hex: string; coder?: string }>([
            { colors: ["red", "blue"], options: [], depth: 1, type: 3, hex: "ffff00000000ffff00000000ffffffff" },
            { colors: ["red", "blue"], options: [], coder: "png32", depth: 8, type: 6, hex: "ffff00000000ffff00000000ffffffff" },
            { colors: ["red", "blue"], options: [], coder: "png64", depth: 16, type: 6, hex: "ffff00000000ffff00000000ffffffff" },
            { colors: ["black", "white"], options: [], depth: 1, type: 0, hex: "000000000000ffffffffffffffffffff" },
            { colors: ["red", "blue"], options: ["-type", "Grayscale"], depth: 16, type: 0, hex: "367036703670ffff127b127b127bffff" },
            { colors: ["#123456789abc", "#101120213031"], options: [], depth: 16, type: 2, hex: "123456789abcffff101120213031ffff" },
            { colors: ["#123456789abc7654", "#1011202130314012"], options: [], depth: 16, type: 6, hex: "123456789abc76541011202130314012" }
        ])(`${mode} ${destination}: selects PNG representation for $colors $options $coder`, async ({ colors, options, depth, type, hex, coder = "png" }) => {
            const args = ["-background", "none", ...colors.map(color => `xc:${color}`), "-geometry", "+0+0", "-tile", "2x1", ...options, `${coder}:${destination}`];
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
            expect([header.getUint32(16), header.getUint32(20), output[24], output[25], output[28]]).toEqual([2, 1, depth, type, 0]);
            const image = decodeImage(output);
            const samples = image.data16 ?? Uint16Array.from(image.data, value => value * 257);
            const rgba = Buffer.alloc(samples.length * 2);
            samples.forEach((value, index) => rgba.writeUInt16BE(value, index * 2));
            expect(rgba.toString("hex")).toBe(hex);
        });
    }
}
