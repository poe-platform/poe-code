import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

for (const depth of [8, 16]) {
    const input = new Uint8Array(readFileSync(new URL(`./fixtures/wavelet-denoise-${depth}.png`, import.meta.url)));
    const original = decodeImage(input);
    for (const mode of ["command", "buffered", "retained", "sync", "mogrify", "retained-mogrify", "sync-mogrify"] as const) {
        it.each(["0", "6%"])(`preserves native ${depth}-bit wavelet samples at %s (${mode})`, async threshold => {
            const mogrify = mode.endsWith("mogrify");
            const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/input.png", input);
            const args = mogrify ? ["-wavelet-denoise", threshold, "/input.png"]
                : ["/input.png", "-wavelet-denoise", threshold, `PNG${depth * 4}:/output.png`];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode.startsWith("sync") ? (mogrify ? runMogrifyCliSync : runConvertCliSync)(args, files)
                : await (mogrify ? runMogrifyCli : runConvertCli)(args, mode.startsWith("retained") ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            const destination = mogrify ? "/input.png" : "/output.png";
            const output = decodeImage(mode === "command" || mode.startsWith("retained") ? await fs.readFile(destination) : files.get(destination)!);
            expect([output.width, output.height]).toEqual([32, 32]);
            const samples = depth === 16 ? output.data16! : output.data;
            const source = depth === 16 ? original.data16! : original.data;
            expect(samples).toBeDefined();
            expect(samples.filter((_, i) => i % 4 === 3)).toEqual(source.filter((_, i) => i % 4 === 3));
            if (threshold === "0") expect(samples).toEqual(source);
            else {
                // ImageMagick 7.1.2-35 Q16-HDRI, PNG64/PNG32 decoded to big-endian RGBA.
                const bytes = Buffer.alloc(samples.length * depth / 8);
                if (depth === 16) samples.forEach((value, i) => bytes.writeUInt16BE(value, i * 2));
                else bytes.set(samples);
                expect(createHash("sha256").update(bytes).digest("hex")).toBe(depth === 16
                    ? "becac8c909b086d738ccb1afe0c0e793d8782084a2b3d092660635d14c2bc4df"
                    : "362010ad1fa8794378bace39fe5e7876909552b9bfbf6fbe664c1a5a0521d6f1");
            }
        });
    }
}
