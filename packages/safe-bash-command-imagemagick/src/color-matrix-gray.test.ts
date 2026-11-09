import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded after PNG32/PNG64 output.
const cases = [
    { name: "no matrix", matrices: [], gray: [62, 78, 0] },
    { name: "identity", matrices: ["1 0 0 0 1 0 0 0 1"], gray: [62, 78, 0] },
    { name: "blue row", matrices: ["0,0,0 0,0,0 0,0,1"], gray: [62, 78, 0] },
    { name: "red row", matrices: ["1 0 0 0 0 0 0 0 0"], gray: [0, 0, 0] },
    { name: "chained rows", matrices: ["0 0 0 0 0 0 0 0 2", "0 0 0 0 0 0 0.5 0 0"], gray: [62, 78, 0] },
    { name: "short matrix", matrices: ["0 0 0 0"], gray: [62, 78, 0] },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: keeps $name output grayscale after conversion`, async ({ matrices, gray }) => {
        const input = encodeImage({ width: 3, height: 1,
            data: Uint8Array.from([200, 21, 62, 128, 15, 99, 51, 255, 0, 0, 0, 200]),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-colorspace", "gray", ...matrices.flatMap(matrix => ["-color-matrix", matrix]), "PNG32:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(gray.flatMap((value, i) => [value, value, value, [128, 255, 200][i]]));
    });

    it.each([false, true])(`${mode}: preserves 16-bit gray samples, alpha=%s`, async hasAlpha => {
        const samples = [0x4321, 0x4321, 0x4321, hasAlpha ? 0x9876 : 65535];
        const input = encodeImage({ width: 1, height: 1,
            data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: Uint16Array.from(samples),
            format: "png", space: "grey16", channels: hasAlpha ? 2 : 1, depth: "ushort", density: 72, hasAlpha
        }, { format: "png" }).data;
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", "-color-matrix", "0 0 0 0 0 0 0 0 1", "PNG64:/out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect(output[24]).toBe(16);
        expect([...decodeImage(output).data16!]).toEqual(samples);
    });
}
