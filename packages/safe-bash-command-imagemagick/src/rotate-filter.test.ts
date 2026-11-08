import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI, 4x2 grayscale input rotated clockwise 30 degrees.
const rasters = {
    "default": [255, 255, 255, 255, 255, 255, 255, 148, 138, 255, 255, 255, 251, 109, 49, 81, 204, 255, 255, 224, 188, 154, 119, 244, 255, 255, 255, 241, 242, 255, 255, 255, 255, 255, 255, 255],
    "box": [255, 255, 255, 255, 255, 255, 255, 133, 133, 255, 255, 255, 255, 130, 40, 70, 255, 255, 255, 255, 160, 190, 100, 255, 255, 255, 255, 238, 238, 255, 255, 255, 255, 255, 255, 255],
    "point": [255, 255, 255, 255, 255, 255, 255, 150, 149, 255, 255, 255, 248, 115, 73, 96, 202, 255, 255, 220, 185, 157, 128, 246, 255, 255, 255, 235, 240, 255, 255, 255, 255, 255, 255, 255],
    "triangle": [255, 255, 255, 255, 255, 255, 255, 145, 151, 255, 255, 255, 251, 113, 70, 83, 209, 255, 255, 224, 180, 160, 126, 250, 255, 255, 255, 236, 239, 255, 255, 255, 255, 255, 255, 255],
    "catrom": [255, 255, 255, 255, 255, 255, 255, 122, 119, 255, 255, 255, 255, 72, 2, 31, 213, 255, 255, 235, 194, 152, 66, 254, 255, 255, 255, 250, 251, 255, 255, 255, 255, 255, 255, 255],
    "mitchell": [255, 255, 255, 255, 255, 255, 255, 146, 136, 255, 255, 255, 253, 106, 45, 76, 205, 255, 255, 225, 188, 154, 114, 245, 255, 255, 255, 242, 243, 255, 255, 255, 255, 255, 255, 255],
    "lanczos": [255, 255, 255, 255, 249, 254, 255, 145, 127, 255, 255, 255, 254, 99, 23, 86, 190, 255, 255, 229, 200, 135, 121, 240, 255, 255, 255, 250, 244, 255, 254, 253, 255, 255, 255, 255],
    "gaussian": [255, 252, 252, 255, 255, 255, 252, 164, 153, 237, 254, 255, 242, 132, 79, 108, 202, 251, 251, 220, 181, 159, 146, 240, 255, 254, 249, 235, 236, 254, 255, 255, 255, 255, 255, 255],
    "cubic": [255, 249, 250, 255, 255, 255, 250, 170, 153, 227, 253, 255, 238, 139, 88, 122, 196, 248, 249, 216, 182, 156, 162, 235, 255, 254, 245, 233, 234, 252, 255, 255, 255, 254, 254, 255],
    "hermite": [255, 255, 255, 255, 255, 255, 255, 151, 157, 255, 255, 255, 255, 120, 65, 72, 230, 255, 255, 238, 171, 165, 111, 255, 255, 255, 255, 239, 240, 255, 255, 255, 255, 255, 255, 255],
    "robidouxsharp": [255, 255, 255, 255, 255, 255, 255, 142, 133, 255, 255, 255, 255, 100, 38, 69, 206, 255, 255, 227, 189, 153, 106, 246, 255, 255, 255, 243, 244, 255, 255, 255, 255, 255, 255, 255],
    "lanczos2": [255, 255, 255, 255, 255, 255, 255, 150, 134, 255, 255, 255, 249, 110, 44, 87, 196, 255, 255, 222, 190, 147, 126, 240, 255, 255, 255, 242, 242, 255, 255, 255, 255, 255, 255, 255],
    "lanczossharp": [255, 255, 255, 255, 249, 254, 255, 145, 127, 255, 255, 255, 255, 98, 22, 83, 191, 255, 255, 229, 201, 137, 118, 241, 255, 255, 255, 250, 245, 255, 255, 253, 255, 255, 255, 254],
    "lanczos2sharp": [255, 255, 255, 255, 255, 255, 255, 147, 135, 255, 255, 255, 251, 107, 44, 81, 199, 255, 255, 223, 190, 151, 119, 242, 255, 255, 255, 241, 243, 255, 255, 255, 255, 255, 255, 255],
    "sinc": [177, 255, 255, 0, 255, 255, 255, 0, 149, 255, 255, 226, 255, 0, 0, 0, 202, 255, 0, 220, 255, 0, 0, 255, 255, 0, 0, 235, 255, 255, 255, 255, 255, 0, 255, 163],
    "jinc": [255, 255, 255, 255, 230, 246, 255, 162, 152, 255, 255, 251, 255, 123, 57, 126, 197, 255, 252, 242, 225, 152, 142, 239, 251, 249, 254, 254, 243, 255, 249, 245, 245, 246, 251, 252],
    "hann": [255, 255, 255, 255, 252, 255, 255, 145, 127, 255, 255, 255, 252, 101, 27, 84, 191, 255, 255, 226, 196, 138, 121, 240, 255, 255, 255, 247, 243, 255, 255, 254, 255, 255, 255, 255],
    "blackman": [255, 255, 255, 255, 254, 255, 255, 148, 133, 255, 255, 255, 250, 108, 40, 86, 195, 255, 255, 224, 192, 145, 124, 241, 255, 255, 255, 243, 242, 255, 255, 255, 255, 255, 255, 255],
    "quadratic": [255, 254, 254, 255, 255, 255, 255, 165, 149, 237, 255, 255, 241, 131, 76, 109, 198, 251, 252, 217, 184, 157, 148, 238, 255, 255, 249, 235, 237, 255, 255, 255, 255, 255, 255, 255],
} as const;
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ...Object.entries(rasters).map(([filter, expected]) => ({ label: filter, options: filter === "default" ? [] : ["-filter", filter], angle: "30", width: 6, height: 6, expected })),
        {"label": "blur", "options": ["-filter", "triangle", "-define", "filter:blur=1.5"], "angle": "30", "width": 6, "height": 6, "expected": [255, 248, 250, 255, 255, 255, 254, 179, 151, 221, 255, 255, 237, 144, 91, 132, 188, 244, 246, 211, 181, 153, 169, 232, 255, 255, 243, 234, 232, 255, 255, 255, 255, 254, 254, 255]},
        {"label": "support", "options": ["-filter", "box", "-define", "filter:support=1.5"], "angle": "30", "width": 6, "height": 6, "expected": [255, 224, 220, 255, 255, 255, 206, 202, 189, 198, 255, 255, 237, 158, 122, 153, 206, 233, 237, 224, 157, 148, 192, 233, 255, 255, 232, 241, 228, 248, 255, 255, 255, 250, 251, 255]},
        {"label": "negative angle", "options": ["-filter", "box"], "angle": "-30", "width": 6, "height": 6, "expected": [255, 255, 255, 255, 255, 255, 255, 255, 255, 178, 178, 255, 255, 255, 40, 70, 220, 220, 255, 10, 160, 190, 255, 255, 255, 193, 193, 255, 255, 255, 255, 255, 255, 255, 255, 255]},
        { label: "reset", options: ["-filter", "box", "+filter"], angle: "30", width: 6, height: 6, expected: rasters.default },
        { label: "right angle", options: ["-filter", "triangle"], angle: "90", width: 2, height: 4, expected: [130, 10, 160, 40, 190, 70, 220, 100] },
    ])(`uses rotation filter $label (${mode})`, async ({ label, options, angle, width, height, expected }) => {
        const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160, 190, 220].flatMap(v => [v, v, v]));
        const input = await sharp(pixels, { raw: { width: 4, height: 2, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...options, "-rotate", angle, "out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        const rgba = expected.flatMap(v => [v, v, v, 255]);
        // Sinc cancellation can land on opposite sides of a half-quantum boundary.
        if (label === "sinc") for (let i = 0; i < rgba.length; i++) expect(Math.abs(output.data[i]! - rgba[i]!)).toBeLessThanOrEqual(1);
        else expect([...output.data]).toEqual(rgba);
    });
}
