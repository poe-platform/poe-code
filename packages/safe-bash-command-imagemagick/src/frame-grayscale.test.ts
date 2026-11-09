import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI grayscale input and RGBA8 expectations.
const gray = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAAAAAC4HznGAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAD/h4/MvwAAAAd0SU1FB+oLBxI1FDZF+jkAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6NTM6MjArMDA6MDAuWF0+AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjUzOjIwKzAwOjAwXwXlggAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODo1MzoyMCswMDowMAgQxF0AAAAQSURBVAjXY2BgYGD8z8AAAAMJAQEZMk96AAAAAElFTkSuQmCC", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const outputPrefix of ["", "PNG32:"]) {
        for (const grayscale of [true, false]) {
            it.each([
                { matte: "#e01030", rgba: [224, 16, 48, 255] },
                { matte: "#204080", rgba: [32, 64, 128, 255] },
                { matte: "#20408080", rgba: [32, 64, 128, 128] },
                { matte: "#101010", rgba: [16, 16, 16, 255] },
            ] as const)(`matches every frame pixel for $matte (${mode}, ${outputPrefix || "PNG"}, gray=${grayscale})`, async ({ matte, rgba }) => {
                const source = decodeImage(gray);
                const input = grayscale ? gray : encodeImage({ ...source, space: "srgb", channels: 3 }, { format: "png", pngColorType: 2 }).data;
                const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
                await filesystem.writeFile("/in.png", input);
                const argv = ["/in.png", "-mattecolor", matte, "-frame", "1x1+0+0", `${outputPrefix}/out.png`];
                const argumentValues = createCommandArguments(argv);
                let stderr = "";
                const result = mode === "command" ? await createMagickCommand().execute({
                    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                    signal: new AbortController().signal, stdin: (async function* () {})(),
                    stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
                }) : mode === "sync" ? runConvertCliSync(argv, files)
                    : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
                expect({ exitCode: result.exitCode, stderr: "stderr" in result ? result.stderr : stderr }).toEqual({ exitCode: 0, stderr: "" });
                const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
                expect([output.width, output.height]).toEqual([5, 4]);
                const mattePixel = grayscale ? [rgba[2], rgba[2], rgba[2], rgba[3]] : rgba;
                const expected: number[] = [];
                for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) {
                    const offset = ((y - 1) * 3 + x - 1) * 4;
                    expected.push(...(x > 0 && x < 4 && y > 0 && y < 3 ? source.data.slice(offset, offset + 4) : mattePixel));
                }
                expect(Array.from(output.data)).toEqual(expected);
            });
        }
    }
}
