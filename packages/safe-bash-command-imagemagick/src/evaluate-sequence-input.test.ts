import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "sync", "retained", "magick", "convert"] as const) {
    it.each([
        { label: "before the first image", prefix: [], suffix: ["i.png"], valid: false },
        { label: "after deleting all images", prefix: ["i.png", "+delete"], suffix: ["i.png"], valid: false },
        { label: "inside an empty image group", prefix: ["i.png", "("], suffix: ["i.png", ")"], valid: false },
        { label: "after the input image", prefix: ["i.png"], suffix: [], valid: true }
    ])(`${mode}: evaluate-sequence $label`, async ({ prefix, suffix, valid }) => {
        const samples = [10001, 23002, 30003, 40100, 65535, 1234, 45678, 54321];
        const input = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", channels: 4,
            density: 72, hasAlpha: true, depth: "ushort",
            data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: Uint16Array.from(samples)
        }, { format: "png" }).data;
        const original = new TextEncoder().encode("KEEP");
        const files = new Map([["i.png", input], ["o.png", original]]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
        const args = [...prefix, "-evaluate-sequence", "Mean", ...suffix, "PNG64:o.png"];
        let stdout = "", stderr = "";
        const result = mode === "magick" || mode === "convert" ? { ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
            command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("o.png")! : await fs.readFile("/o.png");
        expect.soft(result.exitCode).toBe(valid ? 0 : 1);
        expect.soft(result.stdout).toBe("");
        if (valid) {
            expect(result.stderr).toBe("");
            const image = decodeImage(output);
            expect([image.width, image.height]).toEqual([2, 1]);
            expect(Array.from(image.data16 ?? [])).toEqual(samples);
        } else {
            expect.soft(result.stderr).toContain("no images found for operation '-evaluate-sequence'");
            expect.soft(output).toEqual(original);
        }
    });
}
