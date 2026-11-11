import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference hashes of decoded 8-bit RGBA pixels.
const cases = [
    ["10/30/60/90%", "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7"],
    ["10,30,60,90%", "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7"],
    ["10x30x60x90%", "4a55d6969b6624d325aff0178a8cea2117261dc38d99bc295f76b5810946ac72"],
    ["10,30%", "4a55d6969b6624d325aff0178a8cea2117261dc38d99bc295f76b5810946ac72"],
    ["10,30,60%", "1996882cc06e8515178963a3c45f3b79d85adc96aac9ba2bddd21ef8bb3a1ece"],
    ["10%", "f3e1f63fd07f0f7aa2a2fb15fedc99ae317e4b7464a274086d0ad7237b468b6a"],
    ["10,30,60,90,95%", "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7"],
    ["10,30,60,90%+1+1", "0878e7ef50bb9c1fe48e2882db73b0802ed4d5e65e633a101d71bd0b65bd97b7"],
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: range geometry %s matches native pixels`, async (threshold, hash) => {
        const files = new Map<string, Uint8Array>([
            ["/in.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAGElEQVR4nGNkYGBQtHbGREyi3JpYET0kABiDD81mogaEAAAAAElFTkSuQmCC", "base64")],
            ["/out.png", new TextEncoder().encode("KEEP")],
        ]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argv = ["/in.png", "-range-threshold", threshold!, "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        const output = decodeImage(bytes);
        expect([output.width, output.height]).toEqual([8, 6]);
        expect(createHash("sha256").update(output.data).digest("hex")).toBe(hash);
    });
}

// ImageMagick Q16-HDRI reference bytes for a nine-pixel gray ramp.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["10x+60+90%", "0000ffffffffffffffffe8927d7d12680000"],
        ["x30+60+90%", "000000000000ffffffffe8927d7d12680000"],
        ["30x30+60+90%", "000000000000ffffffffe8927d7d12680000"],
        ["10x30+60+90%", "000020a1c141ffffffffe8927d7d12680000"],
        ["0x30+60+90%", "00006b15d62bffffffffe8927d7d12680000"],
        ["10x-60+90%", "0000ffffffffffffffffffffffffffff0000"],
    ])(`${mode}: omitted range fields preserve cutoff positions for %s`, async (threshold, expected) => {
        const input = Buffer.concat([Buffer.from("P5\n9 1\n255\n"), Buffer.from([0, 32, 64, 96, 128, 160, 192, 224, 255])]);
        const files = new Map<string, Uint8Array>([["/in.pgm", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.pgm", input);
        const argv = ["/in.pgm", "-range-threshold", threshold!, "-endian", "MSB", "-depth", "16", "gray:/out.gray"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out.gray") : files.get("/out.gray")!;
        expect(Buffer.from(bytes).toString("hex")).toBe(expected);
    });
}
