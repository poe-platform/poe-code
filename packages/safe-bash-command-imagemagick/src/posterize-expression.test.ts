import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = encodeImage({ width: 5, height: 1, format: "png", space: "srgb", channels: 4,
    density: 72, hasAlpha: true, depth: "uchar",
    data: Uint8Array.of(51, 34, 17, 255, 102, 51, 34, 255, 153, 85, 51, 255, 204, 119, 68, 255, 255, 153, 85, 255)
}, { format: "png" }).data;

for (const mode of ["buffered", "sync", "command"] as const) {
    it.each([
        { before: ["+dither"], value: "%[fx:w-2]", literal: "3" },
        { before: ["+dither", "-crop", "4x1+0+0"], value: "%[fx:w-2]", literal: "2" },
        { before: ["+dither", "-set", "levels", "3"], value: "%[levels]", literal: "3" },
        { before: ["+dither", "-set", "option:levels", "3"], value: "%[option:levels]", literal: "3" },
        { before: ["-dither", "Riemersma", "-channel", "R"], value: "%[fx:w-2]", literal: "3" }
    ])(`expands posterize levels for the current image via ${mode}: $before $value`, async ({ before, value, literal }) => {
        const outputs: Uint8Array[] = [];
        for (const levels of [literal, value]) {
            const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argv = ["/in.png", ...before, "-posterize", levels, "-set", "option:levels", "2", "PNG32:/out.png"];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
            expect(result.exitCode).toBe(0);
            outputs.push(decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!).data);
        }
        expect(outputs[1]).toEqual(outputs[0]);
        if (before.length === 1) {
            // ImageMagick 7.1.2-35 Q16-HDRI, independently decoded as RGBA8.
            expect([...outputs[1]!]).toEqual([0, 0, 0, 255, 128, 0, 0, 255, 128, 128, 0, 255, 255, 128, 128, 255, 255, 128, 128, 255]);
        }
    });

    it.each(["", "bogus", "Infinity"])(`preserves output for invalid expanded posterize levels via ${mode}: %j`, async value => {
        const files = new Map([["/in.png", input], ["/out.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", input);
        const argv = ["/in.png", "-set", "option:levels", value, "-posterize", "%[option:levels]", "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(1);
        expect(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")).toEqual(input);
    });

    it(`evaluates posterize levels separately for each image via ${mode}`, async () => {
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argv = ["-size", "5x1", "xc:#806040", "-size", "4x1", "xc:#806040", "+dither", "-posterize", "%[fx:w-2]", "PNG32:/out-%d.png"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
        expect(result.exitCode).toBe(0);
        for (const [index, width, pixel] of [[0, 5, [128, 128, 128, 255]], [1, 4, [255, 0, 0, 255]]] as const) {
            const path = `/out-${index}.png`;
            const output = decodeImage(mode === "command" ? await fs.readFile(path) : files.get(path)!);
            expect(output.width).toBe(width);
            expect([...output.data]).toEqual(Array.from({ length: width }, () => [...pixel]).flat());
        }
    });
}
