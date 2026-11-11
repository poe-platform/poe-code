import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

// Sequence and geometry expectations match ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["buffered", "sync", "magick", "convert"] as const) {
    for (const coder of ["label", "caption"] as const) {
        it.each([
            { operation: "read", suffix: ["-format", "%p/%n:%m;", "info:"], expected: `0/2:XC;1/2:${coder.toUpperCase()};` },
            { operation: "append", suffix: ["+append", "-format", "%wx%h", "info:"], expected: "70x64" },
            { operation: "pixels", suffix: ["+append", "out.png"], expected: "" }
        ])(`${mode}: keeps same-size ${coder} inputs separate ($operation)`, async ({ suffix, expected, operation }) => {
            const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const args = ["-pointsize", "12", "-size", "35x64", "xc:red", `${coder}:Hi`, ...suffix];
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runMagickCliSync(args, files) : mode === "buffered" ? await runConvertCli(args, files) : {
                ...await (mode === "magick" ? createMagickCommand() : createConvertCommand()).execute({
                    command: mode, args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
                }), stdout, stderr
            };
            expect(result).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
            if (operation === "pixels") {
                const image = decodeImage(mode === "buffered" || mode === "sync" ? files.get("out.png")! : await fs.readFile("/out.png"));
                expect([image.width, image.height]).toEqual([70, 64]);
                expect(image.data.every((sample, index) => Math.floor(index / 4) % image.width >= 35
                    || sample === [255, 0, 0, 255][index % 4])).toBe(true);
                expect(image.data.some((sample, index) => Math.floor(index / 4) % image.width >= 35
                    && index % 4 < 3 && sample < 255)).toBe(true);
                expect([...image.data.subarray(35 * 4, 36 * 4)]).toEqual([255, 255, 255, 255]);
            }
        });
    }
}
