import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, 5x4 RGB8 input, -charcoal 0x1, RGBA8 output.
const nativeGray = {
    R: [65, 137, 199, 63, 115, 171, 66, 144, 214, 102, 130, 203, 92, 162, 56, 126, 192, 63, 108, 150],
    G: [187, 154, 87, 72, 57, 82, 113, 49, 67, 128, 30, 69, 118, 145, 125, 114, 99, 164, 168, 75],
    B: [34, 105, 174, 57, 125, 215, 102, 114, 181, 69, 159, 227, 110, 179, 15, 103, 171, 54, 125, 202],
    A: [17, 94, 171, 64, 141, 199, 93, 115, 192, 86, 144, 221, 115, 191, 31, 89, 166, 59, 136, 194],
    RGB: [252, 208, 118, 64, 15, 70, 94, 76, 78, 127, 31, 58, 91, 103, 135, 165, 131, 162, 129, 39],
    default: [243, 205, 122, 57, 13, 66, 93, 74, 75, 123, 30, 60, 81, 95, 126, 164, 135, 148, 114, 42],
};

for (const mode of ["magick", "sync"] as const) {
    it.each([...Object.keys(nativeGray), "RGBA", "reset"])(`${mode}: honors charcoal channel %s`, async channel => {
        const data = Uint8Array.from({ length: 5 * 4 * 4 }, (_, i) =>
            i % 4 === 3 ? 255 : (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 256);
        const input = encodeImage({ width: 5, height: 4, data, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
        const files = new Map([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const selection = channel === "default" ? [] : channel === "reset" ? ["-channel", "R", "+channel"] : ["-channel", channel];
        const argv = ["/input.png", ...selection, "-charcoal", "0x1", "+channel", "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(argv, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([5, 4]);
        const expected = nativeGray[channel === "reset" ? "default" : channel === "RGBA" ? "RGB" : channel as keyof typeof nativeGray];
        expect([...output.data]).toEqual(expected.flatMap(gray => [gray, gray, gray, 255]));
    });
}
