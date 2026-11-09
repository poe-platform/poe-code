import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    async function convert(samples: number[], operations: string[]) {
        const input = encodeImage({ width: samples.length / 4, height: 1,
            data: Uint8Array.from(samples, value => Math.round(value / 257)),
            data16: Uint16Array.from(samples),
            format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const argv = ["in.png", ...operations, "out.png"];
        const files = new Map<string, Uint8Array>([["in.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : mode === "buffered" ? await runConvertCli(argv, files)
            : await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        expect(result.exitCode, stderr).toBe(0);
        return mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
    }

    it.each([undefined, "Default", "default", "All", "RGBA", "RGB"])(`${mode}: constant Polynomial respects channel %s`, async channel => {
        const samples = [11, 22, 33, 88, 55, 66, 77, 99].map(value => value * 257);
        const output = await convert(samples, [
            ...(channel ? ["-channel", channel] : []), "-function", "Polynomial", "0.8", "-depth", "16"
        ]);
        expect([...decodeImage(output).data16!]).toEqual(samples.map((value, index) =>
            channel === "RGB" && index % 4 === 3 ? value : 52428));
    });

    // Native ImageMagick Q16-HDRI results, compared as full-depth samples.
    it.each([
        [[], [0x4321, 0x8765, 0xabcd]],
        [["-function", "Polynomial", "1,0"], [0x4321, 0x8765, 0xabcd]],
        [["-function", "Polynomial", "0.5,0.2"], [0x54c4, 0x76e6, 0x891a]],
        [["-function", "Sinusoid", "1"], [0xff9e, 0x68e4, 0x0f68]],
    ] as const)(`${mode}: preserves full-depth function output %j`, async (operations, expected) => {
        const output = await convert([0x4321, 0x8765, 0xabcd, 65535], ["-channel", "RGB", ...operations]);
        expect(output[24]).toBe(16);
        expect([...decodeImage(output).data16!]).toEqual([...expected, 65535]);
    });

    it.each(["R", "A"])(`${mode}: preserves unselected channels for %s`, async channel => {
        const samples = [1, 17185, 52719, 39030];
        for (const parameters of ["1,0", "0.5,0.2"]) {
            const output = await convert(samples, ["-channel", channel, "-function", "Polynomial", parameters, "+channel", "-depth", "16"]);
            expect([...decodeImage(output).data16!]).toEqual(samples.map((value, index) =>
                parameters === "0.5,0.2" && index === (channel === "R" ? 0 : 3) ? Math.round(value * 0.5 + 65535 * 0.2) : value));
        }
    });
}
