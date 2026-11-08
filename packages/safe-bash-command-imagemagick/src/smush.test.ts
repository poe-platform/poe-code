import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";
import fixtures from "./smush-fixtures.json" with { type: "json" };

// ImageMagick 7 native references, captured with -depth 8 rgba:-.
const transparentFixtures = [
    { name: "+smush transparent canvas", args: ["+smush", "0"], width: 5, height: 5, pageWidth: 8, pageHeight: 5, blueX: 4, blueY: 3 },
    { name: "-smush transparent canvas", args: ["-smush", "0"], width: 5, height: 3, pageWidth: 5, pageHeight: 8, blueX: 2, blueY: 1 },
].map(({ args, width, height, blueX, blueY, ...fixture }) => {
    const pixels = new Array<number>(width * height * 4).fill(0);
    pixels.splice((width + 1) * 4, 4, 255, 0, 0, 255);
    pixels.splice((blueY * width + blueX) * 4, 4, 0, 0, 255, 255);
    return { ...fixture, width, height, pixels, args: ["-background", "none",
        "(", "-size", "5x3", "xc:none", "-fill", "red", "-draw", "point 1,1", ")",
        "(", "-size", "3x5", "xc:none", "-fill", "blue", "-draw", "point 2,3", ")", ...args] };
});

for (const mode of ["public", "sync"] as const) {
    it.each([...fixtures.map(fixture => ({ ...fixture, pageWidth: undefined, pageHeight: undefined })), ...transparentFixtures])(`${mode} $name combines dimensions and pixels`, async ({ args, width, height, pixels, pageWidth, pageHeight }) => {
        const argumentValues = createCommandArguments([...args, "png:-"]);
        let bytes: Uint8Array;
        if (mode === "sync") {
            const result = runConvertCliSync(argumentValues.args, new Map());
            expect(result.exitCode).toBe(0);
            bytes = result.stdoutBytes!;
        } else {
            const chunks: number[] = [];
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: new MemoryFileSystem(),
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { chunks.push(...chunk); } },
                stderr: { async write(chunk) { expect(new TextDecoder().decode(chunk)).toBe(""); } },
            });
            expect(result.exitCode).toBe(0);
            bytes = Uint8Array.from(chunks);
        }
        const actual = decodeImage(bytes);
        expect([actual.width, actual.height]).toEqual([width, height]);
        expect([...actual.data]).toEqual(pixels);
        if (pageWidth !== undefined) expect(actual.virtualCanvas).toEqual({ width: pageWidth, height: pageHeight, x: 0, y: 0 });
    });
}
