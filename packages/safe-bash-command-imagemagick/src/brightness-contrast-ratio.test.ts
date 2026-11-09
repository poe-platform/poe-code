import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, PNG64 output read as 16-bit RGBA.
// Colon geometry resolves to brightness/contrast with a unit contrast; slash is a separator.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [geometry, expected] of [
        ["20:60", [16440, 24133, 41264, 32990]],
        ["0.3333333333x1", [16440, 24133, 41264, 32990]],
        ["20/60", [24579, 43619, 65535, 65535]],
        ["20x60", [24579, 43619, 65535, 65535]],
        ["-20:60", [15999, 23692, 40823, 32548]],
        ["20:-60", [31457, 34504, 41288, 38011]],
        ["0:60", [16220, 23912, 41044, 32769]],
        ["20:0", [65535, 65535, 65535, 65535]],
        ["0:0", [16220, 23912, 41044, 32769]],
        ["20:", [29492, 37108, 54068, 45876]],
        ["20:0.5", [42698, 50391, 65535, 59248]],
        ["20%:60%", [16440, 24133, 41264, 32990]]
    ] as const) {
        it.each([undefined, "RGB", "R", "A"])(`${mode}: preserves native 16-bit samples for ${geometry} with channel %s`, async channel => {
            const samples = [16385, 24001, 40961, 32769];
            const input = encodeImage({ width: 1, height: 1,
                data: Uint8Array.from(samples, value => Math.round(value / 257)),
                data16: Uint16Array.from(samples), format: "png", space: "srgb",
                channels: 4, depth: "ushort", density: 72, hasAlpha: true
            }, { format: "png" }).data;
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["in.png", ...(channel ? ["-channel", channel] : []), "-brightness-contrast", geometry, "out.png"];
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
            expect([...decodeImage(output).data16!]).toEqual(channel === "R"
                ? [expected[0], samples[1], samples[2], samples[3]]
                : channel === "A" ? [...samples.slice(0, 3), expected[3]]
                    : channel === "RGB" ? [...expected.slice(0, 3), samples[3]] : [...expected]);
        });
    }
}
