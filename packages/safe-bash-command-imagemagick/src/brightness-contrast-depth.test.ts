import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it(`${mode}: expands calculated brightness separately for each image`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        for (const width of [3, 1]) {
            const samples = Array.from({ length: width }, () => [16385, 24001, 40961, 32769]).flat();
            const input = encodeImage({ width, height: 1,
                data: Uint8Array.from(samples, value => Math.round(value / 257)),
                data16: Uint16Array.from(samples), format: "png", space: "srgb",
                channels: 4, depth: "ushort", density: 72, hasAlpha: true
            }, { format: "png" }).data;
            files.set(`in${width}.png`, input);
            await fs.writeFile(`/in${width}.png`, input);
        }
        const argv = ["in3.png", "in1.png", "-brightness-contrast", "%[fx:w+17]x60", "PNG64:out-%d.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        // Native ImageMagick: 20x60 for width 3, 18x60 for width 1.
        for (const [index, expected] of [
            [0, Array.from({ length: 3 }, () => [24579, 43619, 65535, 65535]).flat()],
            [1, [21302, 40342, 65535, 62262]]
        ] as const) {
            const output = mode === "command" || mode === "retained"
                ? await fs.readFile(`/out-${index}.png`) : files.get(`out-${index}.png`)!;
            expect([...decodeImage(output).data16!]).toEqual(expected);
        }
    });

    for (const [geometry, expected] of [
        ["0x0", [0x4321, 0x8765, 0xabcd, 0x9876]],
        ["10x20", [0x53e9, 0xa93e, 0xd6c0, 0xbe94]],
        ["%[fx:w+9]x20", [0x53e9, 0xa93e, 0xd6c0, 0xbe94]],
        ["%[fx:20/2]x%[fx:h*20]", [0x53e9, 0xa93e, 0xd6c0, 0xbe94]],
        ["%[option:adjustment]", [0x53e9, 0xa93e, 0xd6c0, 0xbe94]]
    ] as const) {
        it.each([undefined, "RGB", "R", "A"])(`${mode}: preserves native 16-bit samples for ${geometry} with channel %s`, async channel => {
            const samples = [0x4321, 0x8765, 0xabcd, 0x9876];
            const input = encodeImage({ width: 1, height: 1,
                data: Uint8Array.from(samples, value => Math.round(value / 257)),
                data16: Uint16Array.from(samples), format: "png", space: "srgb",
                channels: 4, depth: "ushort", density: 72, hasAlpha: true
            }, { format: "png" }).data;
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["in.png", "-set", "option:adjustment", "10x20", ...(channel ? ["-channel", channel] : []),
                "-brightness-contrast", geometry, "-set", "option:adjustment", "0x0", "out.png"];
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
