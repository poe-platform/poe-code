import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7: magick -size 2x1 -depth 8 rgba:-
// [channel options] -linear-stretch 5% -depth 8 rgba:-
const cases = [
    { colors: ["#204080", "#a0c0e0"], argument: "5%", channel: [], expected: [0, 255, 255, 255, 255, 255, 255, 255] },
    { colors: ["#20408040", "#a0c0e0c0"], argument: "5%", channel: [], expected: [0, 255, 255, 255, 255, 255, 255, 255] },
    { colors: ["#20408040", "#a0c0e0c0"], argument: "5%x5%", channel: [], expected: [0, 4, 134, 4, 199, 255, 255, 255] },
    { colors: ["#20408040", "#a0c0e0c0"], argument: "1x1", channel: [], expected: [0, 4, 134, 4, 199, 255, 255, 255] },
    { colors: ["#20408040", "#a0c0e0c0"], argument: "0", channel: [], expected: [132, 255, 255, 255, 255, 255, 255, 255] },
    { colors: ["#20408040", "#a0c0e0c0"], argument: "0x0", channel: [], expected: [32, 64, 128, 64, 160, 192, 224, 192] },
    { colors: ["#20408040", "#a0c0e0c0"], argument: "5%", channel: ["-channel", "R"], expected: [0, 64, 128, 64, 255, 192, 224, 192] },
    { colors: ["#20408040", "#a0c0e0c0"], argument: "5%", channel: ["-channel", "A"], expected: [32, 64, 128, 255, 160, 192, 224, 255] },
    { colors: ["#808080", "#808080"], argument: "5%", channel: [], expected: [0, 0, 0, 255, 0, 0, 0, 255] },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(cases)(`matches native linear stretch via ${mode}: %j`, async ({ colors, argument, channel, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const pixels = Uint8Array.from(colors.flatMap(color => [1, 3, 5, 7].map(offset =>
            offset < color.length ? parseInt(color.slice(offset, offset + 2), 16) : 255)));
        const input = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        files.set("input.png", input);
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...channel, "-linear-stretch", argument, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
