import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const pages of [1, 2])
it.each([
    { depth: undefined, options: [] }, { depth: 16, options: [] }, { depth: 8, options: [] },
    { depth: 16, options: ["-compress", "LZW", "-define", "tiff:rows-per-strip=1"] },
    { depth: 16, options: ["-compress", "Zip", "-interlace", "plane", "-endian", "MSB", "-define", "tiff:tile-geometry=16x16"] },
    { depth: 16, options: ["-compress", "RLE", "-define", "tiff:format=64"] }
])(`${mode}: preserves RGB TIFF low bits (${pages} pages, depth $depth, $options)`, async ({ depth, options }) => {
    const argv = ["xc:#123456789abc", ...(pages === 2 ? ["xc:red"] : []),
        ...(depth === undefined ? [] : ["-depth", String(depth)]), ...options, "-write", "/copy.tif", "tiff:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), chunks: Uint8Array[] = [];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const stdout = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    const copy = mode === "command" || mode === "retained" ? await fs.readFile("/copy.tif") : files.get("/copy.tif")!;
    for (const bytes of [copy, stdout]) {
        const image = decodeImage(bytes);
        expect(image.bitsPerSample).toBe(depth ?? 16);
        // Native ImageMagick Q16: actual low bits, not byte samples expanded by 257.
        expect(Array.from(depth === 8 ? image.data : image.data16!)).toEqual(depth === 8
            ? [0x12, 0x56, 0x9a, 255] : [0x1234, 0x5678, 0x9abc, 65535]);
        if (pages === 2) {
            const second = decodeImage(bytes, { page: 1 });
            expect(Array.from(depth === 8 ? second.data : second.data16!)).toEqual(depth === 8
                ? [255, 0, 0, 255] : [65535, 0, 0, 65535]);
        }
    }
});

for (const mode of ["sync", "retained"] as const)
it.each([
    ["-define", "tiff:rows-per-strip=1"],
    ["-compress", "LZW", "-define", "tiff:tile-geometry=1024x16", "-interlace", "plane"],
    ["-compress", "Zip", "-define", "tiff:tile-geometry=1024x16", "-endian", "MSB"]
])(`${mode}: preserves varying RGBA samples across storage chunks (%s)`, async (...options) => {
    const width = 1031, height = 3;
    const data16 = Uint16Array.from({ length: width * height * 4 }, (_, i) => i * 1009 % 65536);
    const data = Uint8Array.from(data16, value => Math.round(value / 257));
    const input = encodeImage({ width, height, data, data16, depth: "ushort", bitsPerSample: 16,
        space: "rgb16", channels: 4, hasAlpha: true, format: "raw", density: 72 }, { format: "png" }).data;
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const argv = ["/in.png", ...options, "/out.tif"];
    const result = mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const bytes = mode === "sync" ? files.get("/out.tif")! : await fs.readFile("/out.tif");
    expect(decodeImage(bytes).data16).toEqual(data16);
});
