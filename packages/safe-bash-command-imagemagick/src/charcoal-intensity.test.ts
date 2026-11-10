import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const input = encodeImage({
    width: 5, height: 4,
    data: Uint8Array.from({ length: 80 }, (_, i) => i % 4 === 3 ? 255 : (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 256),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false
}, { format: "png" }).data;

// Native ImageMagick 7.1.2-35 Q16-HDRI, decoded PNG32 grayscale samples.
const rec709 = [243, 205, 122, 57, 13, 66, 93, 74, 75, 123, 30, 60, 81, 95, 126, 164, 135, 148, 114, 42];
const cases = [
    { settings: ["-intensity", "Brightness"], gray: [255, 255, 239, 161, 118, 255, 255, 186, 192, 201, 255, 255, 164, 176, 194, 255, 251, 212, 206, 160] },
    { settings: ["-intensity", "Rec601Luma"], gray: [238, 211, 139, 64, 15, 76, 104, 85, 82, 120, 48, 73, 79, 89, 118, 176, 149, 137, 93, 43] },
    { settings: ["-intensity", "Average"], gray: [226, 215, 160, 72, 26, 129, 145, 102, 72, 91, 116, 117, 76, 67, 86, 197, 168, 106, 60, 57] },
    { settings: ["-intensity", "Lightness"], gray: [226, 209, 139, 75, 27, 157, 162, 102, 66, 70, 153, 137, 77, 57, 67, 193, 150, 98, 78, 52] },
    { settings: ["-intensity", "RMS"], gray: [237, 228, 179, 84, 38, 159, 169, 114, 100, 122, 153, 148, 89, 92, 116, 212, 187, 129, 97, 78] },
    { settings: ["-intensity", "MS"], gray: [255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 241] },
    { settings: ["-intensity", "Rec601Luminance"], gray: [48, 30, 3, 0, 0, 29, 8, 0, 0, 0, 29, 3, 0, 0, 0, 33, 4, 0, 0, 0] },
    { settings: ["-intensity", "Rec709Luminance"], gray: [34, 18, 1, 0, 0, 18, 4, 0, 0, 0, 18, 1, 0, 0, 0, 20, 2, 0, 0, 0] },
    { settings: ["-intensity", "Rec709Luma"], gray: rec709 },
    { settings: ["-intensity", "Average", "+intensity"], gray: rec709 },
    { settings: [], gray: rec709 }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: charcoal honors $settings`, async ({ settings, gray }) => {
        const files = new Map([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(path, data);
        // Reset after rendering to verify that deferred operations capture their intensity.
        const argv = ["/input.png", ...settings, "-charcoal", "0x1", "+intensity", "PNG32:/out.png"];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([5, 4]);
        expect([...output.data]).toEqual(gray.flatMap(value => [value, value, value, 255]));
    });
}
