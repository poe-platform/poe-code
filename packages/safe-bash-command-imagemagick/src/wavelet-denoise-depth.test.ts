import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli, runMogrifyCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([8, 16])(`retains calculated wavelet precision from RGB8 input at depth %s (${mode})`, async depth => {
        const input = Buffer.concat([Buffer.from("P6\n7 5\n255\n"), Buffer.from(Array.from({ length: 105 }, (_, i) => (i * 41 + 51) % 256))]);
        for (const threshold of [undefined, "0", "25%"] as const) {
            const files = new Map([["/input.ppm", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/input.ppm", input);
            const args = ["/input.ppm", ...(threshold === undefined ? [] : ["-wavelet-denoise", threshold]), "-endian", "MSB", "-depth", String(depth), "rgb:/output.rgb"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, stderr).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/output.rgb") : files.get("/output.rgb")!;
            // ImageMagick Q16-HDRI, complete row-major RGB output including zero/no-op controls.
            expect(createHash("sha256").update(output).digest("hex")).toBe(depth === 16
                ? threshold === "25%" ? "43893a98d816d19765d8b376c98565fc53a8ca9911fa38fd1aa0c356cc577e55" : "b3c3ff8a554db91fb0848569f6c964c9d29fa65c0e96c633854e72db1a0872e5"
                : threshold === "25%" ? "806dc3a0bd4f1ebb7d1fd73875830dc9bd6d2841e576d091b6f6a14272601d0b" : "792768fdc255cbd52a08c3a164d2f08c975a583e680ac165220a7e0d25a548ae");
        }
    });
}

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
