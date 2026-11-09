import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const sharp = createRequire(import.meta.url)("sharp") as typeof import("sharp");
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAAAAACs8akEAAAAAmJLR0QA/4ePzL8AAAAHdElNRQfqCwcVLDJ6B8BZAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDIxOjQ0OjUwKzAwOjAw/Du/rQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QyMTo0NDo1MCswMDowMI1mBxEAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMjE6NDQ6NTArMDA6MDDacybOAAAAMElEQVQI12NcIF9pKGdoyChlKGdokGHAOFnewEXO0IDxSKWhvMGLKuZ3GoZWhb9CAcFJC1hpeueNAAAAAElFTkSuQmCC", "base64");

// ImageMagick 7.1.2-35 Q16-HDRI: gray.png +dither -posterize <levels> out.png.
// Pixel vectors independently decoded with magick out.png -depth 8 rgba:-.
for (const mode of ["command", "buffered", "sync"] as const) {
    it.each([
        [2, 1, [255, 255, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]],
        [3, 8, [128, 128, 0, 128, 128, 128, 255, 0, 128, 128, 128, 255, 0, 128, 128, 128, 255, 0, 128, 128, 128, 255, 0, 128, 128, 128, 128, 0, 128, 128, 128, 255, 0, 128, 128]],
        [4, 2, [170, 170, 85, 85, 170, 170, 255, 0, 85, 85, 170, 170, 85, 85, 170, 170, 255, 0, 85, 85, 170, 170, 85, 85, 170, 170, 170, 0, 85, 85, 170, 170, 85, 85, 170]],
        [16, 4, [153, 187, 51, 102, 136, 187, 238, 34, 68, 102, 153, 204, 51, 102, 153, 170, 221, 34, 68, 119, 170, 204, 68, 102, 136, 187, 170, 34, 85, 102, 153, 204, 51, 102, 153]],
    ] as const)(`${mode}: packs grayscale posterization at %i levels`, async (levels, depth, pixels) => {
        const files = new Map([["in.png", new Uint8Array(input)]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const args = ["in.png", "+dither", "-posterize", String(levels), "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect(await sharp(output).ensureAlpha().raw().toBuffer()).toEqual(Buffer.from(pixels.flatMap(value => [value, value, value, 255])));
        expect([...output.subarray(24, 26)]).toEqual([depth, 0]);
    });
}
