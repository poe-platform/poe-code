import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const conversion of [["-type", "Grayscale"], ["-type", "Bilevel"], ["-colorspace", "Gray"], ["-type", "Grayscale", "-background", "red", "-geometry", "+1+1"], []]) {
        it(`${mode}: montage JPEG ${conversion.join(" ") || "color control"}`, async () => {
            const pixels = Uint8Array.from({ length: 24 * 16 * 3 }, (_, index) => {
                const x = Math.floor(index / 3) % 24, y = Math.floor(index / 72);
                return [(x * 23) % 256, (y * 29) % 256, ((x + y) * 37) % 256][index % 3]!;
            });
            const input = Buffer.concat([Buffer.from("P6\n24 16\n255\n"), pixels]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.ppm", input);
            const files = new Map([["/in.ppm", input as Uint8Array]]);
            const args = ["montage", "/in.ppm", "-geometry", "+0+0", "-tile", "1x1", ...conversion, "jpeg:-"];
            const chunks: Uint8Array[] = [];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = mode === "command" ? Buffer.concat(chunks) : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
            let frame: Uint8Array | undefined;
            for (let offset = 2; offset < output.length;) {
                const marker = output[offset + 1]!, length = output[offset + 2]! * 256 + output[offset + 3]!;
                expect(marker).not.toBe(0xc2);
                if (marker === 0xc0) frame = output.subarray(offset + 4, offset + 2 + length);
                if (marker === 0xda) break;
                offset += length + 2;
            }
            const coloredBorder = conversion.includes("red");
            const components = conversion.length && !coloredBorder ? 1 : 3;
            expect(frame?.[5]).toBe(components);
            for (let component = 0; component < components; component++) expect(frame?.[7 + component * 3]).toBe(0x11);
            expect(decodeImage(output)).toMatchObject({ width: coloredBorder ? 26 : 24, height: coloredBorder ? 18 : 16, channels: components, space: components === 1 ? "b-w" : "srgb" });
        });
    }
}
