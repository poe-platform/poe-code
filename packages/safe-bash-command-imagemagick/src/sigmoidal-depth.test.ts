import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [option, expected] of [
        ["-sigmoidal-contrast", [0x2f90, 0x8ae1, 0xbce0, 0xa360]],
        ["+sigmoidal-contrast", [0x5434, 0x8506, 0x9e9b, 0x90bf]]
    ] as const) {
        it.each([undefined, "Default", "default", "All", "RGBA", "RGB", "R", "A"])(`${mode}: preserves native 16-bit samples for ${option} with channel %s`, async channel => {
            const samples = [0x4321, 0x8765, 0xabcd, 0x9876];
            const input = encodeImage({ width: 1, height: 1,
                data: Uint8Array.from(samples, value => Math.round(value / 257)),
                data16: Uint16Array.from(samples), format: "png", space: "srgb",
                channels: 4, depth: "ushort", density: 72, hasAlpha: true
            }, { format: "png" }).data;
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["in.png", ...(channel ? ["-channel", channel] : []), option, "5x50%", "out.png"];
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
