import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7: magick -size 2x1 -depth 8 rgba:-
// [channel options] -contrast-stretch 5% -depth 8 rgba:-
const cases = [
    { colors: ["#204080", "#a0c0e0"], channel: [], expected: [0, 4, 134, 255, 199, 255, 255, 255] },
    { colors: ["#20408040", "#a0c0e0c0"], channel: [], expected: [0, 4, 134, 4, 199, 255, 255, 255] },
    { colors: ["#20408040", "#a0c0e0c0"], channel: ["-channel", "RGB"], expected: [0, 0, 0, 64, 255, 255, 255, 192] },
    { colors: ["#20408040", "#a0c0e0c0"], channel: ["-channel", "R"], expected: [0, 64, 128, 64, 255, 192, 224, 192] },
    { colors: ["#20408040", "#a0c0e0c0"], channel: ["-channel", "A"], expected: [32, 64, 128, 0, 160, 192, 224, 255] },
    { colors: ["#808080", "#808080"], channel: [], expected: [128, 128, 128, 255, 128, 128, 128, 255] },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native contrast stretch via ${mode}: %j`, async ({ colors, channel, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const pixels = Uint8Array.from(colors.flatMap(color => [1, 3, 5, 7].map(offset =>
            offset < color.length ? parseInt(color.slice(offset, offset + 2), 16) : 255)));
        const input = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        files.set("input.png", input);
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...channel, "-contrast-stretch", "5%", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
