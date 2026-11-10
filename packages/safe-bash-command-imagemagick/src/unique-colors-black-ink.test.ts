import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const ink = new Uint8Array([
    ...new TextEncoder().encode("P7\nWIDTH 4\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"),
    ...[10, 50, 10, 200].flatMap(k => [255, 255, 255, k]),
]);
const colors = [[248, 29, 162], [11, 75, 254], [92, 240, 126], [140, 38, 93]];
const rgb = new Uint8Array([
    ...new TextEncoder().encode("P6\n4 2\n255\n"),
    ...[1, 2, 3, 0, 3, 1, 0, 2].flatMap(index => colors[index]!),
]);

// Native ImageMagick 7.1.2-35 Q16-HDRI results, including decoded PNG64 samples.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { input: "ink.pam", operations: ["-unique-colors", "-format", "%w %[colorspace]", "info:/out"], text: "3 CMYK" },
        { input: "ink.pam", operations: ["-unique-colors", "-format", "%k %w", "info:/out"], text: "3 3" },
        { input: "ink.pam", operations: ["-format", "%w %[colorspace]", "info:/out"], text: "4 CMYK" },
        { input: "ink.pam", operations: ["-channel", "K", "-separate", "PNG64:/out"], inks: [10, 50, 10, 200] },
        { input: "in.ppm", operations: ["-unique-colors", "-format", "%k %w", "info:/out"], text: "4 4" },
        { input: "ink.pam", operations: ["-unique-colors", "-unique-colors", "-channel", "K", "-separate", "PNG64:/out"], inks: [10, 50, 200] },
    ])(`preserves distinct CMYK black inks (${mode}): $input $operations`, async ({ input, operations, text, inks }) => {
        const files = new Map([["/ink.pam", ink], ["/in.ppm", rgb], ["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = [`/${input}`, ...operations];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
        if (text !== undefined) expect(new TextDecoder().decode(output)).toBe(text);
        else {
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([inks!.length, 1]);
            expect(Array.from(image.data16!)).toEqual(inks!.flatMap(k => [k * 257, k * 257, k * 257, 65535]));
        }
    });
}

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([false, true])(`keeps Q16 ink and alpha differences across storage chunks (${mode}, unique=%s)`, async unique => {
        const pixels = [
            [65535, 65535, 65535, 2570, 65535],
            [65535, 65535, 65535, 12850, 65535],
            [65535, 65535, 65535, 2570, 65534],
            [65534, 65535, 65535, 2570, 65535],
        ];
        const input = new Uint8Array([
            ...new TextEncoder().encode("P7\nWIDTH 1025\nHEIGHT 1\nDEPTH 5\nMAXVAL 65535\nTUPLTYPE CMYK_ALPHA\nENDHDR\n"),
            ...Array.from({ length: 1025 }, (_, index) => pixels[index % pixels.length]!).flatMap(pixel => pixel.flatMap(value => [value >> 8, value & 255])),
        ]);
        const files = new Map([["/ink.pam", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/ink.pam", input);
        const args = ["/ink.pam", ...(unique ? ["-unique-colors", "-unique-colors"] : []), "-format", "%k %w", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe(unique ? "4 4" : "4 1025");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
    });
}
