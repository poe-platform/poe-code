import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick truncates offsets before applying gravity.
const cases = ["+0+0", "+0.5+0.5", "+0.9+0.9", "-0.5-0.5", "+1+1", "+1.5+1.5"].flatMap((offset) => {
    const step = offset.startsWith("+1") ? 1 : 0;
    return [
        ["NorthWest", `2x1${offset}`, 2, 1, step, step],
        ["Center", `2x1${offset}`, 2, 1, 2 + step, 1 + step],
        ["SouthEast", `2x1${offset}`, 2, 1, 5 - step, 4 - step],
    ] as const;
});
for (const mode of ["buffered", "retained", "command", "sync"]) {
    it.each(cases)(`matches native splice bands, mode=${mode}, gravity=%s, geometry=%s`, async (gravity, geometry, columns, rows, bandX, bandY) => {
        const pixels = Uint8Array.from(Array.from({ length: 20 }, (_, i) => [i + 1, i + 90, 200 - i, 255]).flat());
        const bytes = await sharp(pixels, { raw: { width: 5, height: 4, channels: 4 } }).png().toBuffer();
        const files = new Map([["input.png", bytes], ["out.png", new TextEncoder().encode("keep")]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        await filesystem.writeFile("/out.png", new TextEncoder().encode("keep"));
        const args = ["input.png", "-gravity", gravity, "-splice", geometry, "out.png"];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else if (mode === "sync") {
            expect(runMagickCliSync(args, files).exitCode).toBe(0);
        } else {
            expect((await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode).toBe(0);
        }
        const output = decodeImage(mode === "buffered" || mode === "sync" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([5 + columns, 4 + rows]);
        const expected = [];
        for (let y = 0; y < output.height; y++) {
            for (let x = 0; x < output.width; x++) {
                if ((x >= bandX && x < bandX + columns) || (y >= bandY && y < bandY + rows)) {
                    expected.push(255, 255, 255, 255);
                } else {
                    const sourceX = x < bandX ? x : x - columns;
                    const sourceY = y < bandY ? y : y - rows;
                    const i = sourceY * 5 + sourceX;
                    expected.push(i + 1, i + 90, 200 - i, 255);
                }
            }
        }
        expect(output.data).toEqual(Uint8Array.from(expected));
    });
}
