import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const) {
    for (const destination of ["-", "/sheet.png"]) it.each([
        { options: [], chromaticity: true, background: true },
        { options: ["-define", "png:exclude-chunk= cHrM , BkGd "], chromaticity: false, background: false },
        { options: ["-define", "png:exclude-chunk=unknown"], chromaticity: true, background: true },
        { options: ["-define", "png:exclude-chunk=cHRM"], chromaticity: false, background: true },
        { options: ["-define", "png:exclude-chunk=bKGD"], chromaticity: true, background: false },
        { options: ["-define", "png:exclude-chunk=cHRM,bKGD"], chromaticity: false, background: false },
        { options: ["-define", "png:exclude-chunk=cHRM", "+define", "png:exclude-chunk"], chromaticity: true, background: true },
        { options: ["-define", "png:exclude-chunk=cHRM", "-define", "png:exclude-chunk=bKGD"], chromaticity: true, background: false }
    ])(`${mode} ${destination}: PNG exclusions $options`, async ({ options, chromaticity, background }) => {
        const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", ...options, `png24:${destination}`];
        const fs = new MemoryFileSystem();
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
            const files = new Map<string, Uint8Array>();
            const result = mode === "sync" ? runMontageCliSync(args, files)
                : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            output = destination === "-" ? result.stdoutBytes! : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
        }
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        const chunks = new Map<string, Uint8Array>();
        for (let offset = 8; offset < output.length;) {
            const length = view.getUint32(offset);
            chunks.set(new TextDecoder().decode(output.subarray(offset + 4, offset + 8)), output.slice(offset + 8, offset + 8 + length));
            offset += length + 12;
        }
        // ImageMagick 7.1.2-35 Q16-HDRI; each exclusion preserves the other chunk.
        const chrm = chunks.get("cHRM");
        expect(chrm && Array.from({ length: 8 }, (_, index) => new DataView(chrm.buffer, chrm.byteOffset, chrm.byteLength).getUint32(index * 4)))
            .toEqual(chromaticity ? [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000] : undefined);
        const bkgd = chunks.get("bKGD");
        expect(bkgd && [...bkgd]).toEqual(background ? [0, 255, 0, 255, 0, 255] : undefined);
        expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe("ff0000ff0000ffff");
    });
}
