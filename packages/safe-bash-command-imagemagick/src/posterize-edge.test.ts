import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI, decoded as RGBA8; keep transparent RGB samples.
for (const execution of ["command", "buffered", "sync"] as const) {
    for (const dither of [[], ["+dither"]]) {
        it.each([
            [3, 0, [0, 0, 0, 255]],
            [3, 1, [0, 0, 0, 255]],
            [3, 2, [0, 0, 255, 255]],
            [4, 0, [0, 0, 255, 0, 255, 255, 0, 0, 0, 0, 0, 0]],
            [4, 1, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
            [4, -1, [25, 100, 220, 255, 255, 128, 127, 128, 255, 128, 127, 0]],
            [4, -2, [25, 100, 220, 255, 255, 128, 127, 128, 255, 128, 127, 0]],
            [4, -3, [25, 100, 220, 255, 255, 128, 127, 128, 255, 128, 127, 0]],
        ] as const)(`${execution}: posterize edge channels=%i levels=%i dither=${dither.length === 0}`, async (channels, levels, expected) => {
            const pixels = channels === 3 ? [25, 100, 220] : [25, 100, 220, 255, 255, 128, 127, 128, 255, 128, 127, 0];
            const input = await sharp(Uint8Array.from(pixels), {
                raw: { width: pixels.length / channels, height: 1, channels }
            }).png().toBuffer();
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = ["in.png", ...dither, "-posterize", String(levels), "out.png"];
            const argumentValues = createCommandArguments(args);
            const result = execution === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : execution === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
            expect(result.exitCode).toBe(0);
            expect([...decodeImage(execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!).data]).toEqual(expected);
        });
    }
}

// Selected alpha also affects RGB during native palette conversion.
it.each([
    ["R", 0, [0, 128, 127, 128]],
    ["R", 1, [0, 128, 127, 128]],
    ["RGB", 0, [0, 0, 0, 128]],
    ["RGB", 1, [0, 0, 0, 128]],
    ["A", 0, [0, 0, 0, 0]],
    ["A", 1, [0, 0, 0, 0]],
    ["RA", 0, [255, 0, 0, 0]],
    ["RA", 1, [0, 0, 0, 0]],
] as const)("posterize edge channel=%s levels=%i", async (channel, levels, expected) => {
    const files = new Map<string, Uint8Array>();
    const result = await runConvertCli(["-size", "1x1", "xc:#ff807f80", "-channel", channel,
        "+dither", "-posterize", String(levels), "+channel", "out.png"], files);
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(files.get("out.png")!).data]).toEqual(expected);
});
