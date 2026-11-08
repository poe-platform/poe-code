import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI, 5x4 xc:'#204060', red point at 3,2.
const cases = [
    ["2", 2, 4], ["2x", 2, 0], ["2x0", 2, 0],
    ["40%", 2, 2], ["8@", 8, 4], ["40x25%", 2, 1], ["2x1@", 2, 1],
    ["x2", 0, 2], ["x40%", 5, 2], ["40x%", 2, 2], ["0", 0, 4]
] as const;
for (const mode of ["buffered", "retained", "command"]) {
    it.each(cases)(`preserves native implicit splice dimensions and pixels, mode=${mode}, geometry=%s`, async (geometry, columns, rows) => {
        const pixels = Uint8Array.from(Array.from({ length: 20 }, (_, i) => i === 13 ? [255, 0, 0, 255] : [32, 64, 96, 255]).flat());
        const bytes = await sharp(pixels, { raw: { width: 5, height: 4, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["input.png", "-background", "red", "-splice", geometry, "out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            expect((await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode).toBe(0);
        }
        const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([5 + columns, 4 + rows]);
        const expected = [];
        for (let y = 0; y < output.height; y++) {
            for (let x = 0; x < output.width; x++) {
                const red = x < columns || y < rows || (x === columns + 3 && y === rows + 2);
                expected.push(...(red ? [255, 0, 0, 255] : [32, 64, 96, 255]));
            }
        }
        expect(output.data).toEqual(Uint8Array.from(expected));
    });
}
