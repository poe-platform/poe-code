import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    async function convert(input: Uint8Array, operations: string[] = ["-sort-pixels"]) {
        const files = new Map([["in.ppm", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", input);
        const argv = ["in.ppm", ...operations, "out.png"], args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        return decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
    }

    it(`${mode}: sorts each scanline by intensity without separating RGB pixels`, async () => {
        // ImageMagick 7.1.2-35 reference, including a red pixel darker than gray 30.
        const pixels = [[0, 255, 0], [0, 0, 255], [255, 0, 0], [0, 0, 0],
            [255, 255, 255], [100, 0, 0], [170, 170, 170], [30, 30, 30]];
        const input = Uint8Array.from([...new TextEncoder().encode("P6\n4 2\n255\n"), ...pixels.flat()]);
        const unchanged = await convert(input, []);
        expect([...unchanged.data]).toEqual(pixels.flatMap(pixel => [...pixel, 255]));
        const output = await convert(input);
        expect([output.width, output.height]).toEqual([4, 2]);
        expect([...output.data]).toEqual([3, 1, 2, 0, 5, 7, 6, 4].flatMap(index => [...pixels[index]!, 255]));
    });

    it(`${mode}: uses the selected intensity and preserves ties and whole pixels`, async () => {
        const pixels = [[90, 0, 0, 10], [0, 90, 0, 20], [0, 0, 90, 30], [20, 20, 20, 255]];
        const input = encodeImage({ width: 4, height: 1, data: Uint8Array.from(pixels.flat()),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const output = await convert(input, ["-intensity", "Average", "-channel", "R", "-sort-pixels", "+intensity"]);
        expect([...output.data]).toEqual([3, 0, 1, 2].flatMap(index => pixels[index]!));
    });

    it.each(["sRGB", "HSL"])(`${mode}: sorts across I/O chunks without mixing scanlines (%s)`, async space => {
        const width = 1025;
        const samples = Array.from({ length: width * 2 }, (_, i) => i < width ? width - i : 5000 - i);
        const input = encodeImage({ width, height: 2, data: Uint8Array.from(samples.flatMap(v => [v, v, v, 65535]), v => Math.round(v / 257)),
            data16: Uint16Array.from(samples.flatMap(v => [v, v, v, 65535])), format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const output = await convert(input, ["-colorspace", space, "-sort-pixels", "-colorspace", "sRGB"]);
        const expected = [...samples.slice(0, width).reverse(), ...samples.slice(width).reverse()];
        expect([...output.data16!]).toEqual(expected.flatMap(v => [v, v, v, 65535]));
    });

    it(`${mode}: carries fractional working samples with sorted pixels`, async () => {
        const pixels = [[9, 9, 9, 10], [3, 3, 3, 20], [7, 7, 7, 30]];
        const input = encodeImage({ width: 3, height: 1, data: Uint8Array.from(pixels.flat()),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const output = await convert(input, ["-channel", "RGB", "-evaluate", "Divide", "2", "-sort-pixels", "-evaluate", "Multiply", "2"]);
        expect([...output.data]).toEqual([1, 2, 0].flatMap(index => pixels[index]!));
    });

    it(`${mode}: preserves alpha and distinct 16-bit pixels while sorting`, async () => {
        const pixels = [[257, 257, 257, 30000], [1, 1, 1, 65535], [256, 256, 256, 0]];
        const input = encodeImage({ width: 3, height: 1, data: Uint8Array.from(pixels.flat(), v => Math.round(v / 257)),
            data16: Uint16Array.from(pixels.flat()), format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const output = await convert(input);
        expect([...output.data16!]).toEqual([1, 2, 0].flatMap(index => pixels[index]!));
    });
}
