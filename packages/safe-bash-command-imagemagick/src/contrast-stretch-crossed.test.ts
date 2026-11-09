import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [10, 140, 45, 10, 140, 45, 90, 60, 110, 105, 195, 130, 165, 45, 180, 200, 80, 220, 200, 80, 220];
// Native ImageMagick 7.1.2-31 Q16-HDRI: magick in.png -contrast-stretch <points> -depth 8 rgb:-
const cases = [
    { points: "1x1", expected: [0, 255, 0, 0, 255, 0, 70, 0, 214, 178, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255] },
    { points: "3x3", expected: pixels },
    { points: "4x4", expected: [0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255] },
    { points: "6x6", expected: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 255, 255, 0, 255] },
];

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native contrast stretch boundaries via ${mode}: $points`, async ({ points, expected }) => {
        const input = await sharp(Uint8Array.from(pixels), { raw: { width: 7, height: 1, channels: 3 } }).png().toBuffer();
        const files = new Map([["input.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-contrast-stretch", points, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data].filter((_, index) => index % 4 !== 3)).toEqual(expected);
    });
}
