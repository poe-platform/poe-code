import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const option of ["-sigmoidal-contrast", "+sigmoidal-contrast"]) {
        it.each([
            ["6X25%", "6x25%"],
            ["6X16384", "6x16384"],
            ["6,25%", "6x25%"],
            ["6/25%", "6x25%"],
            ["6x2 5%", "6x25%"],
            [" 6 , 2 5 % ", "6x25%"],
            ["6/1 6384", "6x16384"],
            ["6,16384", "6x16384"],
            ["6", "6x50%"]
        ])(`${mode}: ${option} reads midpoint in %s like %s`, async (geometry, canonical) => {
            // Native ImageMagick treats comma/slash as x and ignores spaces within fields.
            const samples = [0, 16384, 32768, 49151, 65535].flatMap(value => [value, value, value, 65535]);
            const input = encodeImage({
                width: 5, height: 1, data: Uint8Array.from(samples, value => Math.round(value / 257)),
                data16: Uint16Array.from(samples), format: "png", space: "srgb",
                channels: 4, depth: "ushort", density: 72, hasAlpha: false
            }, { format: "png" }).data;
            const outputs: Uint16Array[] = [];
            for (const value of [geometry, canonical]) {
                const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const argv = ["in.png", option, value, "PNG48:out.png"];
                const args = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write() {} }
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
                expect(output[24]).toBe(16);
                outputs.push(decodeImage(output).data16!);
            }
            expect(outputs[0]).toEqual(outputs[1]);
        });
    }
}
