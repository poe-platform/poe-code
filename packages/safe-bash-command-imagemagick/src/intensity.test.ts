import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

const shapePixels = [0, 40, 90, 0, 80, 100, 150, 128, 200, 50, 70, 255];
const stretchPixels = [10, 140, 45, 255, 10, 140, 45, 255, 90, 60, 110, 255, 105, 195, 130, 255, 165, 45, 180, 255, 200, 80, 220, 255, 200, 80, 220, 255];
// ImageMagick 7.1.2-35 Q16-HDRI, decoded at depth 8 on the reported RGB/RGBA fixtures.
const cases = [
    ["Average", [43, 110, 107], [0, 188, 0, 0, 188, 0, 63, 0, 113, 100, 255, 163, 251, 0, 255, 255, 38, 255, 255, 38, 255]],
    ["Mean", [43, 110, 107], [0, 188, 0, 0, 188, 0, 63, 0, 113, 100, 255, 163, 251, 0, 255, 255, 38, 255, 255, 38, 255]],
    ["Brightness", [90, 150, 200], [0, 70, 0, 0, 70, 0, 0, 0, 0, 0, 197, 46, 128, 0, 162, 209, 0, 255, 209, 0, 255]],
    ["Lightness", [45, 115, 125], [0, 221, 0, 0, 221, 0, 51, 0, 119, 102, 255, 187, 255, 0, 255, 255, 17, 255, 255, 17, 255]],
    ["MS", [13, 51, 62], [0, 255, 44, 0, 255, 44, 164, 84, 218, 204, 255, 255, 255, 44, 255, 255, 138, 255, 255, 138, 255]],
    ["RMS", [57, 114, 126], [0, 151, 0, 0, 151, 0, 13, 0, 69, 55, 255, 124, 220, 0, 255, 255, 0, 255, 255, 0, 255]],
    ["Rec601Luma", [34, 100, 97], [0, 194, 0, 0, 194, 0, 45, 0, 105, 90, 255, 164, 255, 0, 255, 255, 16, 255, 255, 16, 255]],
    ["Rec601Luminance", [6, 34, 51], [0, 255, 83, 0, 255, 83, 226, 131, 255, 255, 255, 255, 255, 83, 255, 255, 195, 255, 255, 195, 255]],
    ["Rec709Luma", [35, 99, 83], [0, 176, 0, 0, 176, 0, 50, 0, 101, 88, 255, 151, 239, 0, 255, 255, 25, 255, 255, 25, 255]],
    ["Rec709Luminance", [6, 33, 38], [0, 255, 76, 0, 255, 76, 198, 117, 252, 238, 255, 255, 255, 76, 255, 255, 171, 255, 255, 171, 255]]
] as const;

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    async function convert(pixels: number[], operations: string[], before: string[] = []) {
        const input = encodeImage({ width: pixels.length / 4, height: 1, data: Uint8Array.from(pixels),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const files = new Map([["in.png", input], ["out.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        await fs.writeFile("/out.png", input);
        const argv = [...before, "in.png", ...operations, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        return { result, stderr: "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr, input, output };
    }

    it.each(cases)(`${mode}: uses %s for alpha shape and linear stretch`, async (method, alpha, stretched) => {
        const shape = await convert(shapePixels, ["-background", "#123456", "-intensity", method, "-alpha", "shape", "+intensity"]);
        expect(shape.result.exitCode, shape.stderr).toBe(0);
        expect([...decodeImage(shape.output).data]).toEqual(alpha.flatMap(value => [18, 52, 86, value]));
        const stretch = await convert(stretchPixels, ["-intensity", method, "-linear-stretch", "1x1", "+intensity"]);
        expect(stretch.result.exitCode, stretch.stderr).toBe(0);
        expect([...decodeImage(stretch.output).data].filter((_, i) => i % 4 !== 3)).toEqual(stretched);
    });

    it.each([[], ["-intensity", "Average", "+intensity"], ["-intensity", "Undefined"]].map(setting => ({ setting })))(`${mode}: preserves default intensity with $setting`, async ({ setting }) => {
        const shape = await convert(shapePixels, [...setting, "-background", "#123456", "-alpha", "shape"]);
        expect(shape.result.exitCode, shape.stderr).toBe(0);
        expect([...decodeImage(shape.output).data]).toEqual([35, 99, 83].flatMap(value => [18, 52, 86, value]));
    });

    it(`${mode}: accepts intensity before input and applies it to alpha copy`, async () => {
        const shape = await convert(shapePixels, ["-alpha", "copy", "-alpha", "activate"], ["-intensity", "aVeRaGe"]);
        expect(shape.result.exitCode, shape.stderr).toBe(0);
        expect([...decodeImage(shape.output).data]).toEqual(shapePixels.map((value, i) => i % 4 === 3 ? [43, 110, 107][Math.floor(i / 4)] : value));
    });

    it.each(["invalid", "sRGB", ""])(`${mode}: rejects intensity %j without replacing output`, async method => {
        const shape = await convert(shapePixels, ["-intensity", method, "-alpha", "shape", "+intensity"]);
        expect(shape.result.exitCode).toBe(1);
        expect(shape.stderr).toContain("intensity");
        expect(shape.output).toEqual(shape.input);
    });
}

it("passes intensity settings through mogrify", async () => {
    const fs = new MemoryFileSystem();
    const input = encodeImage({ width: 3, height: 1, data: Uint8Array.from(shapePixels),
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    await fs.writeFile("/in.png", input);
    const result = await runMogrifyCli(["-intensity", "Average", "-background", "#123456", "-alpha", "shape", "in.png"], { filesystem: fs, cwd: "/" });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect([...decodeImage(await fs.readFile("/in.png")).data]).toEqual([43, 110, 107].flatMap(value => [18, 52, 86, value]));
});
