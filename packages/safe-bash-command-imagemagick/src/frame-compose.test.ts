import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;

for (const mode of ["public", "sync"] as const) {
    for (const geometry of ["2x2", "2x2+1+1"]) {
        it.each([
            { compose: "Clear", expected: [0, 0, 0, 0] },
            { compose: "Dst", expected: [223, 223, 223, 255] },
            { compose: "Plus", expected: [224, 224, 224, 255] },
            { compose: "Over", expected: [1, 1, 1, 255] },
        ])(`composes opaque frame interiors: ${mode} ${geometry} $compose`, async ({ compose, expected }) => {
            const data = Uint8Array.from({ length: 10 * 8 * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) + 1);
            const image = await frame(data, 10, 8, ["-mattecolor", "red", "-compose", compose, "-frame", geometry], mode);
            expect([image.width, image.height]).toEqual([14, 12]);
            expect([...image.data.slice((2 * 14 + 2) * 4, (2 * 14 + 3) * 4)]).toEqual(expected);
            if (geometry === "2x2") expect([...image.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
        });
        it.each([
            { compose: "Src", expected: [200, 10, 40, 0, 200, 10, 40, 128, 200, 10, 40, 255] },
            { compose: "CopyOpacity", expected: [32, 64, 96, 0, 32, 64, 96, 128, 32, 64, 96, 255] },
            { compose: "Over", expected: [32, 64, 96, 128, 144, 28, 59, 192, 200, 10, 40, 255] },
        ])(`composes translucent frame interiors: ${mode} ${geometry} $compose`, async ({ compose, expected }) => {
            const data = new Uint8Array([200, 10, 40, 0, 200, 10, 40, 128, 200, 10, 40, 255]);
            const image = await frame(data, 3, 1, ["-bordercolor", "#20406080", "-compose", compose, "-frame", geometry], mode);
            expect([...image.data.slice((2 * 7 + 2) * 4, (2 * 7 + 5) * 4)]).toEqual(expected);
        });
    }
}

// Full-raster reference: ImageMagick 7.1.2-35 Q16-HDRI (older versions copy unselected source channels).
for (const mode of ["public", "sync"] as const) {
    it.each([
        { channel: undefined, interior: [205, 124, 151, 255] },
        { channel: "R", interior: [205, 223, 223, 255] },
        { channel: "B", interior: [223, 223, 151, 255] },
        { channel: "A", interior: [223, 223, 223, 255] },
    ])(`${mode}: honors frame color channel $channel across the full raster`, async ({ channel, interior }) => {
        const args = ["-size", "3x2", "xc:#c0306090", "-mattecolor", "#2880b070", ...(channel ? ["-channel", channel] : []), "-compose", "Over", "-frame", "3x3+0+0", "-depth", "8", "rgba:out.rgba"];
        const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(args);
        let stderr = "";
        const result = mode === "sync" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        expect(result.exitCode, stderr).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const actual = mode === "sync" ? files.get("out.rgba")! : await fs.readFile("/out.rgba");
        const expected = Uint8Array.from({ length: 9 * 8 * 4 }, (_, i) => {
            const x = Math.floor(i / 4) % 9, y = Math.floor(i / 36);
            return (x >= 3 && x < 6 && y >= 3 && y < 5 ? interior : [40, 128, 176, 112])[i % 4]!;
        });
        expect(actual).toEqual(expected);
    });
}

async function frame(data: Uint8Array, width: number, height: number, options: string[], mode: "public" | "sync") {
    const input = encodeImage({ width, height, data, format: "png", depth: "uchar", density: 72, channels: 4, space: "srgb", hasAlpha: data.some((value, index) => index % 4 === 3 && value < 255) }, { format: "png" }).data;
    const args = ["input.png", ...options, "PNG32:out.png"];
    const verify = (bytes: Uint8Array) => {
        const image = decodeImage(bytes);
        if (nativeAvailable) {
            const native = spawnSync("magick", ["png:-", ...options, "-depth", "8", "PNG32:-"], { input });
            expect(native.status, native.stderr.toString()).toBe(0);
            const reference = decodeImage(native.stdout);
            expect([image.width, image.height]).toEqual([reference.width, reference.height]);
            expect(image.data).toEqual(reference.data);
        }
        return image;
    };
    if (mode === "sync") {
        const files = new Map([["input.png", input]]);
        const result = runConvertCliSync(args, files);
        expect(result.exitCode, result.stderr).toBe(0);
        return verify(files.get("out.png")!);
    }
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const argumentValues = createCommandArguments(args);
    let stderr = "";
    const result = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    expect(result.exitCode, stderr).toBe(0);
    return verify(await fs.readFile("/out.png"));
}
