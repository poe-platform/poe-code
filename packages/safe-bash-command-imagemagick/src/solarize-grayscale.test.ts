import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const) {
    async function convert(depth: 8 | 16, alpha: boolean, operations: string[], output: string) {
        const samples = [120, 120, 120, alpha ? 30 : 255, 200, 200, 200, alpha ? 160 : 255];
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from(samples),
            ...(depth === 16 ? { data16: Uint16Array.from(samples, value => value * 257) } : {}),
            format: "png", space: depth === 16 ? "grey16" : "b-w", channels: alpha ? 2 : 1,
            depth: depth === 16 ? "ushort" : "uchar", density: 72, hasAlpha: alpha
        }, { format: "png" }).data;
        expect(input[25]).toBe(alpha ? 4 : 0);
        const argv = ["gray.png", ...operations, output];
        const files = new Map<string, Uint8Array>([["gray.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/gray.png", input);
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runConvertCliSync(argv, files)
            : mode === "buffered" ? await runConvertCli(argv, files)
            : await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
                cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        return output === "info:" ? ("stdout" in result && typeof result.stdout === "string" ? result.stdout : stdout)
            : decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
    }

    for (const depth of [8, 16] as const) {
        for (const alpha of [false, true]) {
            it.each(["R", "G", "B"])(`${mode}: preserves color and alpha from ${depth}-bit grayscale (alpha=${alpha}) solarize %s`, async channel => {
                // Native Q16: gray.png -channel R/G/B -solarize 40% +channel PNG:out.png
                const output = await convert(depth, alpha, ["-channel", channel, "-solarize", "40%", "+channel"], "PNG:out.png");
                if (typeof output === "string") throw new Error("expected image");
                // Native loads opaque 8-bit grayscale PNG as a palette and solarizes every RGB entry.
                const palette = depth === 8 && !alpha;
                const selected = ["R", "G", "B"].indexOf(channel);
                const expected = [120, 120, 120, alpha ? 30 : 255, 200, 200, 200, alpha ? 160 : 255]
                    .map((value, index) => (palette ? index % 4 < 3 : index % 4 === selected) ? 255 - value : value);
                expect([...output.data]).toEqual(expected);
                if (depth === 16) expect([...output.data16!]).toEqual(expected.map(value => value * 257));
            });
        }
    }

    it.each([false, true])(`${mode}: promotes grayscale metadata even without changed samples (solarize=%s)`, async solarize => {
        const output = await convert(8, true, [...(solarize ? ["-solarize", "100%"] : []), "-format", "%[colorspace]|%[channels]|%r"], "info:");
        expect(typeof output === "string" ? output.trim() : output).toBe(solarize ? "sRGB|srgba 4.0|DirectClass sRGB Alpha" : "Gray|graya 2.0|DirectClass Gray Alpha");
    });
}
