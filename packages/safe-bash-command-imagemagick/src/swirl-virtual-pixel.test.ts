import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: 2x9 PNG input, PNG32 output,
// then independently decoded with magick png:- -depth 8 rgba:-.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAAJCAIAAACXE2qwAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjE6NTg6MTYrMDA6MDDAE7sjAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIxOjU4OjE2KzAwOjAwsU4DnwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMTo1ODoxNiswMDowMOZbIkAAAAAsSURBVAjXY2SV5xfXF2bRi1NDo+JgPIbXX88yqTxglAz+LK4vzOi+URKhEgBrsgzf3u56XgAAAABJRU5ErkJggg==", "base64");
const edge = [5, 31, 15, 255, 28, 78, 34, 255, 51, 125, 53, 255, 76, 144, 74, 255, 97, 219, 91, 255, 186, 144, 164, 255, 143, 57, 129, 255, 44, 119, 50, 255, 189, 151, 167, 255, 133, 137, 200, 255, 235, 245, 205, 255, 96, 109, 208, 255, 25, 83, 243, 255, 170, 113, 151, 255, 71, 177, 25, 255, 16, 65, 157, 255, 117, 15, 63, 255, 132, 89, 76, 255];
const background = [5, 31, 15, 255, 28, 78, 34, 255, 51, 125, 53, 255, 76, 144, 74, 255, 97, 219, 91, 255, 186, 144, 164, 255, 143, 57, 129, 255, 44, 119, 50, 255, 189, 151, 167, 255, 146, 122, 179, 255, 235, 245, 205, 255, 96, 109, 208, 255, 25, 83, 243, 255, 180, 100, 134, 255, 71, 177, 25, 255, 142, 31, 74, 255, 117, 15, 63, 255, 161, 68, 58, 255];
const tile = [5, 31, 15, 255, 28, 78, 34, 255, 51, 125, 53, 255, 76, 144, 74, 255, 97, 219, 91, 255, 186, 144, 164, 255, 143, 57, 129, 255, 44, 119, 50, 255, 189, 151, 167, 255, 141, 142, 198, 255, 235, 245, 205, 255, 96, 109, 208, 255, 25, 83, 243, 255, 168, 107, 149, 255, 71, 177, 25, 255, 97, 133, 188, 255, 117, 15, 63, 255, 127, 78, 71, 255];
const unchanged = [5, 31, 15, 255, 28, 78, 34, 255, 51, 125, 53, 255, 74, 172, 72, 255, 97, 219, 91, 255, 120, 10, 110, 255, 143, 57, 129, 255, 166, 104, 148, 255, 189, 151, 167, 255, 212, 198, 186, 255, 235, 245, 205, 255, 2, 36, 224, 255, 25, 83, 243, 255, 48, 130, 6, 255, 71, 177, 25, 255, 94, 224, 44, 255, 117, 15, 63, 255, 140, 62, 82, 255];

// Native ImageMagick 7.1.2-35 Q16-HDRI, big-endian RGBA16 pixel (1,4).
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        ["black", "#2872a380", "vertical-tile", "bilinear", "0d5526003655ffff"],
        ["black", "#2872a380", "checker-tile", "bilinear", "0d5526003655ffff"],
        ["black", "#2872a380", "horizontal-tile", "spline", "02d108070b7affff"],
        ["red", "#2872a380", "vertical-tile", "bilinear", "b85426003655ffff"],
        ["#ff0000ff", "#2872a380", "vertical-tile", "bilinear", "d4e516db20add5aa"],
        ["black", "#2872a380", "background", "bilinear", "080516db20add5aa"],
        ["black", "#2872a3ff", "vertical-tile", "bilinear", "0d5526003655ffff"],
        ["black", "#2872a380", "vertical-tile", "bilinear", "Blend:True"],
    ] as const)(`${mode}: preserves source alpha with %s, background %s, %s, %s (%s)`, async (color, background, virtualPixel, interpolation, expected) => {
        const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
        const info = expected === "Blend:True";
        const args = ["-size", "2x5", `xc:${color}`, "-background", background, "-virtual-pixel", virtualPixel, "-interpolate", interpolation, "-swirl", "-210",
            ...(info ? ["-format", "%A:%[opaque]", "info:"] : ["-crop", "1x1+1+4", "+repage", "-depth", "16", "-endian", "MSB", "rgba:-"])];
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        if (info) expect("stdout" in result ? result.stdout : Buffer.concat(stdout).toString()).toBe(expected);
        else {
            const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
            expect(Buffer.from(bytes).toString("hex")).toBe(expected);
        }
    });
}

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { options: [], angle: "-360", expected: edge },
        { options: ["-background", "red"], angle: "-360", expected: edge },
        { options: ["-virtual-pixel", "edge"], angle: "-360", expected: edge },
        { options: ["-background", "red", "-virtual-pixel", "background"], angle: "-360", expected: background },
        { options: ["-virtual-pixel", "tile"], angle: "-360", expected: tile },
        { options: ["-background", "red"], angle: "0", expected: unchanged },
    ])(`${mode}: matches native narrow swirl $angle with $options`, async ({ options, angle, expected }) => {
        const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...options, "-swirl", angle, "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([2, 9]);
        expect([...output.data]).toEqual(expected);
    });
}
