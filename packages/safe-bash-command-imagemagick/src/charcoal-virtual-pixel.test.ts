import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGB8 input, -background red -charcoal 0x1.
const native = {
    edge: [243, 205, 122, 57, 13, 66, 93, 74, 75, 123, 30, 60, 81, 95, 126, 164, 135, 148, 114, 42],
    white: [7, 94, 104, 104, 40, 59, 185, 221, 213, 121, 89, 208, 242, 230, 118, 44, 143, 166, 137, 30],
    tile: [235, 192, 136, 181, 205, 123, 68, 37, 97, 158, 39, 18, 38, 69, 82, 153, 119, 115, 159, 158],
    mirror: [237, 197, 110, 82, 121, 49, 72, 52, 76, 157, 18, 26, 60, 83, 120, 104, 101, 132, 114, 45],
    black: [248, 154, 107, 115, 177, 137, 38, 16, 23, 110, 76, 18, 30, 29, 128, 139, 87, 109, 115, 191],
    background: [201, 148, 114, 142, 193, 131, 37, 54, 54, 121, 72, 42, 45, 45, 137, 141, 116, 155, 137, 201],
    transparent: [247, 179, 130, 147, 228, 126, 45, 13, 47, 171, 96, 16, 13, 30, 142, 189, 122, 118, 113, 174],
    "horizontal-tile": [228, 169, 155, 210, 241, 91, 46, 49, 68, 109, 62, 36, 38, 45, 56, 55, 112, 165, 120, 75],
};
const data = Uint8Array.from({ length: 5 * 4 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 256);
const input = encodeImage({ width: 5, height: 4, data, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;

for (const mode of ["command", "sync"] as const) {
    it.each([...Object.keys(native), "reset"])(`${mode}: matches native charcoal with %s virtual pixels`, async method => {
        const files = new Map([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]), fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/input.png", "-background", "red", "-virtual-pixel", method === "reset" ? "mirror" : method,
            ...(method === "reset" ? ["-virtual-pixel", "edge"] : []), "-charcoal", "0x1",
            "-virtual-pixel", "white", "-background", "blue", "PNG32:/out.png"];
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([5, 4]);
        expect(Array.from(output.data)).toEqual(native[method === "reset" ? "edge" : method as keyof typeof native].flatMap(gray => [gray, gray, gray, 255]));
    });
}
