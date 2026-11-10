import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["-threshold", "R", "32768",
            [0, 0, 0, 65535].flatMap(red => [red, 0x1234, 0x4567, 0x89ab]),
            [32766, 32767, 32768, 32769].flatMap(red => [red, 0x1234, 0x4567, 0x89ab])],
        ["-threshold", "R", "32768", [0, 32769, 32770, 32769]],
        ["-threshold", "RGB", "32769", [0, 0, 65535, 32769]],
        ["-threshold", "A", "32769", [32768, 32769, 32770, 0]],
        ["-threshold", "R", "50%", [0, 32769, 32770, 32769]],
        ["-threshold", "", "32769", [0, 0, 0, 0]],
        ["-threshold", "Default", "32769", [0, 0, 0, 0]],
        ["-black-threshold", "", "32769", [0, 0, 0, 32769]],
        ["-white-threshold", "", "32769", [32768, 32769, 32770, 65535]],
        ["-white-threshold", "", "32768", [65535, 65535, 65535, 65535]],
        ["-black-threshold", "A", "32768",
            [0, 0, 100, 101, 65535].flatMap(alpha => [32768, 32769, 32770, alpha]),
            [0, 99, 100, 101, 65535].flatMap(alpha => [32768, 32769, 32770, alpha])],
        ["-white-threshold", "A", "32768",
            [0, 99, 100, 65535, 65535].flatMap(alpha => [32768, 32769, 32770, alpha]),
            [0, 99, 100, 101, 65535].flatMap(alpha => [32768, 32769, 32770, alpha])],
        ["-black-threshold", "RGB", "32769", [0, 32769, 32770, 32769]],
        ["-white-threshold", "RGB", "32769", [32768, 32769, 65535, 32769]],
        ["-black-threshold", "R", "32769", [0, 32769, 32770, 32769]],
        ["-white-threshold", "B", "32769", [32768, 32769, 65535, 32769]],
        ["-black-threshold", "RGBA", "32769,32769,32769,32769", [0, 32769, 32770, 32769]],
        ["-white-threshold", "RGBA", "32769,32769,32769,32768", [32768, 32769, 65535, 65535]],
        ["-black-threshold", "RGB", "50%", [32768, 32769, 32770, 32769]],
        ["-white-threshold", "RGB", "50%", [65535, 65535, 65535, 32769]],
    ] as const)(`preserves full samples for %s -channel %s %s via ${mode}`, async (operator, channels, threshold, expected, samples = [32768, 32769, 32770, 32769]) => {
        const input = encodeImage({ width: samples.length / 4, height: 1, data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: Uint16Array.from(samples), format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true }, { format: "png" }).data;
        expect([...decodeImage(input).data16!]).toEqual(samples);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const files = new Map([["input.png", input]]);
        const args = ["input.png", ...(channels ? ["-channel", channels] : []), operator, threshold, "out.png"];
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stderr = "";
            const context = {
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} },
                stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
                registerCleanup() {}, fs: filesystem,
            } as unknown as CommandContext;
            expect(await createMagickCommand().execute(context)).toMatchObject({ exitCode: 0 });
            expect(stderr).toBe("");
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
        }
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        const image = decodeImage(output);
        expect(image.depth).toBe("ushort");
        expect([...image.data16!]).toEqual(expected);
    });
}
