import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    for (const dither of [[], ["+dither"]]) {
        // ImageMagick 7.1.2 Q16-HDRI reference samples, including controls.
        it.each([
            [4, [0x5555, 0xaaaa, 0xaaaa]],
            [17, [0x4000, 0x8000, 0xafff]],
            [256, [0x4343, 0x8787, 0xabab]],
            [257, [0x4300, 0x86ff, 0xabff]],
            [1024, [0x4311, 0x8761, 0xabea]],
        ] as const)(`${mode}: preserves Q16 posterization at %i levels, dither=${dither.length === 0}`, async (levels, expected) => {
            const data16 = Uint16Array.of(0x4321, 0x8765, 0xabcd, 65535);
            const input = encodeImage({ width: 1, height: 1, density: 72, data16,
                data: Uint8Array.from(data16, value => Math.round(value / 257)),
                hasAlpha: false, channels: 3, space: "srgb", depth: "ushort", format: "png"
            }, { format: "png" }).data;
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = ["in.png", ...dither, "-posterize", String(levels), "out.png"];
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
            const samples = output.data16 ?? Uint16Array.from(output.data, value => value * 257);
            expect([...samples]).toEqual([...expected, 65535]);
            if (levels === 17 || levels > 256) expect(output.data16).toBeDefined();
        });
    }
}

for (const mode of ["command", "buffered", "sync"] as const) {
    it(`${mode}: preserves unselected Q16 channels across transfer boundaries`, async () => {
        const data16 = Uint16Array.from({ length: 1025 * 4 }, (_, i) => [0x4321, 0x8765, 0xabcd, 0x9876][i % 4]!);
        const input = encodeImage({ width: 1025, height: 1, density: 72, data16,
            data: Uint8Array.from(data16, value => Math.round(value / 257)),
            hasAlpha: true, channels: 4, space: "srgb", depth: "ushort", format: "png"
        }, { format: "png" }).data;
        const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["in.png", "+dither", "-channel", "R", "-posterize", "17", "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect(output.data16).toEqual(Uint16Array.from(data16, (value, i) => i % 4 === 0 ? 0x4000 : value));
    });
}
