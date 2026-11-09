import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const samples = [0, 16384, 32768, 49151, 65535].flatMap(value => [value, value, value, 65535]);
const input = encodeImage({ width: 5, height: 1, format: "png", space: "srgb", channels: 3,
    density: 72, hasAlpha: false, depth: "ushort", data16: Uint16Array.from(samples),
    data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const [operator, expected] of [
        ["-sigmoidal-contrast", [0, 25803, 51606, 62574, 65535]],
        ["+sigmoidal-contrast", [0, 11225, 20166, 30682, 65535]]
    ] as const) {
        it.each([
            { before: [], literal: "6x25%" },
            { before: ["-resize", "3x1!"], literal: "4x25%" }
        ])(`expands ${operator} strength using the current image via ${mode}: $before`, async ({ before, literal }) => {
            const outputs: Uint16Array[] = [];
            for (const geometry of [literal, "%[fx:w+1]x25%"]) {
                const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const argv = ["/in.png", ...before, operator, geometry, "PNG48:/out.png"];
                const args = createCommandArguments(argv);
                const result = mode === "command" ? await createMagickCommand().execute({ command: "magick", args: args.args,
                    argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } })
                    : mode === "sync" ? runConvertCliSync(argv, files)
                        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
                expect(result.exitCode).toBe(0);
                const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
                expect(output.depth).toBe("ushort");
                outputs.push(output.data16!);
            }
            expect(outputs[1]).toEqual(outputs[0]);
            if (before.length === 0) {
                // ImageMagick 7 Q16-HDRI reference for the literal and expanded geometry.
                expect(Array.from(outputs[1]!)).toEqual(expected.flatMap(value => [value, value, value, 65535]));
            }
        });
    }
}
