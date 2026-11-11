import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16, identical PNG input: magick input.png [options] -depth 8 rgba:-
const pixels = [
    100, 150, 200, 255, 100, 150, 200, 160, 0, 0, 0, 0, 255, 255, 255, 255,
    64, 64, 64, 100, 128, 128, 128, 255, 200, 100, 50, 255, 20, 40, 80, 255
];

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const channel of [[], ["-channel", "R"], ["-channel", "A"]]) {
        it.each([
            ["-contrast", [
                107, 160, 213, 255, 107, 160, 213, 160, 0, 0, 0, 0, 255, 255, 255, 255,
                51, 51, 51, 100, 128, 128, 128, 255, 213, 107, 53, 255, 17, 34, 69, 255
            ]],
            ["+contrast", [
                93, 140, 187, 255, 93, 140, 187, 160, 0, 0, 0, 0, 255, 255, 255, 255,
                77, 77, 77, 100, 128, 128, 128, 255, 187, 93, 47, 255, 23, 46, 91, 255
            ]]
        ] as const)(`matches native %s via ${mode} with ${channel.join(" ") || "default channels"}`, async (option, expected) => {
            const input = await sharp(Uint8Array.from(pixels), {
                raw: { width: 8, height: 1, channels: 4 }
            }).png().toBuffer();
            const files = new Map([["input.png", input]]);
            const filesystem = new MemoryFileSystem();
            if (mode === "retained") await filesystem.writeFile("/input.png", input);
            const args = ["input.png", ...channel, option, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toEqual({ exitCode: 0, stdout: "", stderr: `magick: option has been replaced '${option}', use "${option[0]}level" at CLI arg ${channel.length + 2}\n` });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected);
        });
    }
}
