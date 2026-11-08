import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    async function convert(samples: number[], depth: 8 | 16, operations: string[]) {
        const input = encodeImage({ width: samples.length / 4, height: 1,
            data: Uint8Array.from(samples, value => depth === 16 ? Math.round(value / 257) : value),
            ...(depth === 16 ? { data16: Uint16Array.from(samples) } : {}),
            format: "png", space: "srgb", channels: 4, depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: true
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

    it.each([[], ["-depth", "16"]].map(depth => ({ depth })))(`${mode}: preserves 16-bit threshold boundaries %j`, async ({ depth }) => {
        const values = [1, 255, 256, 32767, 32768, 32769, 65534, 65535];
        const output = await convert(values.flatMap(v => [v, v, v, 65535]), 16, ["-channel", "RGB", "-solarize", "32768", ...depth]);
        expect(output[24]).toBe(16);
        expect([...decodeImage(output).data16!]).toEqual([1, 255, 256, 32767, 32768, 32766, 1, 0].flatMap(v => [v, v, v, 65535]));
    });

    it.each(["R", "A"])(`${mode}: preserves unselected 16-bit channels for %s`, async channel => {
        const samples = [0x4000, 0x4001, 0x4002].flatMap(r => [r, 0x4321, 0xcdef, 0x9876]);
        const output = await convert(samples, 16, ["-channel", channel, "-solarize", "16385", "+channel"]);
        expect(output[24]).toBe(16);
        expect([...decodeImage(output).data16!]).toEqual(samples.map((v, i) => i % 4 === (channel === "R" ? 0 : 3) && v > 16385 ? 65535 - v : v));
    });

    it.each([[], ["-colorspace", "XYZ"], ["-colorspace", "HSL"], ["-colorspace", "HWB"], ["-colorspace", "RGB"], ["-evaluate", "Divide", "2"]].map(before => ({ before })))(
        `${mode}: preserves intermediate precision at 100% after $before`, async ({ before }) => {
            const samples = [127, 128, 129, 47, 42, 52, 70, 255];
            const after = before[0] === "-colorspace" ? ["-colorspace", "sRGB"] : before[0] === "-evaluate" ? ["-evaluate", "Multiply", "2"] : [];
            const control = decodeImage(await convert(samples, 8, [...before, ...after]));
            const output = decodeImage(await convert(samples, 8, [...before, "-solarize", "100%", ...after]));
            expect([...output.data]).toEqual([...control.data]);
        }
    );
    it(`${mode}: preserves all 16-bit samples at 100%`, async () => {
        const samples = [1, 255, 256, 32767, 32768, 32769, 65534, 65535];
        const output = await convert(samples, 16, ["-solarize", "100%"]);
        expect(output[24]).toBe(16);
        expect([...decodeImage(output).data16!]).toEqual(samples);
    });
}
