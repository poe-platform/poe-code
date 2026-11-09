import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7: magick input.png <operation> <argument> -depth 8 rgb:-
const cases = [
    { operation: "-linear-stretch", arguments: ["2", "2x"], expected: [0, 255, 0, 0, 255, 0, 98, 0, 255, 250, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255] },
    { operation: "-linear-stretch", arguments: ["2x0"], expected: [0, 87, 0, 0, 87, 0, 14, 0, 43, 36, 167, 73, 124, 0, 146, 175, 0, 204, 175, 0, 204] },
    { operation: "-linear-stretch", arguments: ["20%", "20%x"], expected: [0, 255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255] },
    { operation: "-linear-stretch", arguments: ["20%x0"], expected: [0, 87, 0, 0, 87, 0, 14, 0, 43, 36, 167, 73, 124, 0, 146, 175, 0, 204, 175, 0, 204] },
    { operation: "-contrast-stretch", arguments: ["2", "2x"], expected: [0, 255, 0, 0, 255, 0, 0, 0, 113, 0, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255] },
    { operation: "-contrast-stretch", arguments: ["2x0"], expected: [0, 134, 0, 0, 134, 0, 0, 0, 17, 0, 255, 95, 231, 0, 255, 255, 0, 255, 255, 0, 255] },
    { operation: "-contrast-stretch", arguments: ["20%", "20%x"], expected: [0, 255, 0, 0, 255, 0, 70, 0, 214, 178, 255, 255, 255, 0, 255, 255, 0, 255, 255, 0, 255] },
    { operation: "-contrast-stretch", arguments: ["20%x0"], expected: [0, 168, 0, 0, 168, 0, 27, 0, 83, 69, 255, 140, 238, 0, 255, 255, 0, 255, 255, 0, 255] },
];
for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const { operation, arguments: args, expected } of cases) {
        it.each(args)(`${operation} white point via ${mode}: %s`, async argument => {
            const pixels = Uint8Array.from([
                10, 140, 45, 10, 140, 45, 90, 60, 110, 105, 195, 130,
                165, 45, 180, 200, 80, 220, 200, 80, 220
            ]);
            const input = await sharp(pixels, { raw: { width: 7, height: 1, channels: 3 } }).png().toBuffer();
            const files = new Map([["input.png", input]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", input);
            const command = ["input.png", operation, argument, "out.png"];
            const result = mode === "sync" ? runConvertCliSync(command, files)
                : await runConvertCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
            expect([...decodeImage(output).data].filter((_, index) => index % 4 !== 3)).toEqual(expected);
        });
    }
}
