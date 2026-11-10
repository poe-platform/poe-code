import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const [geometry, tileWidth, tileHeight, single, offset] of [["3x2#", 3, 2, false, 0], ["3x2+0+0#", 3, 2, true, 0], ["3x2+1+1#", 3, 2, true, 1], ["3x2+0+0", 3, 2, true, 0]] as const) {
    it(`preserves every patterned crop tile for ${geometry}`, async () => {
        const pixels = Uint8Array.from({ length: 7 * 5 * 3 }, (_, i) => Math.floor(i / 3) + 1);
        const bytes = await sharp(pixels, { raw: { width: 7, height: 5, channels: 3 } }).png().toBuffer();
        const fs = new MemoryFileSystem();
        const command = createMagickCommand();
        async function execute(output: string) {
            const args = createCommandArguments(["png:-", "-crop", geometry, "-format", "%wx%h%X%Y\\n", output]);
            let stdout = "", stderr = "";
            const result = await command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () { yield bytes; })(), stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
            expect(result.exitCode).toBe(0);
            expect(stderr).toBe("");
            return stdout;
        }
        const tiles = [];
        for (let top = offset; top < (single ? offset + 1 : 5); top += tileHeight)
            for (let left = offset; left < (single ? offset + 1 : 7); left += tileWidth)
                tiles.push({ left, top, width: Math.min(tileWidth, 7 - left), height: Math.min(tileHeight, 5 - top) });
        const expected = tiles.map(t => `${t.width}x${t.height}+${t.left}+${t.top}\n`).join("");
        expect(await execute("info:")).toBe(expected);
        expect((await runMagickCli(["png:-", "-crop", geometry, "-format", "%wx%h%X%Y\\n", "info:"], new Map(), bytes)).stdout).toBe(expected);
        expect(runMagickCliSync(["png:-", "-crop", geometry, "-format", "%wx%h%X%Y\\n", "info:"], new Map(), bytes).stdout).toBe(expected);
        const output = single ? "/tile-0.png" : "/tile-%d.png";
        await execute(output);
        const files = new Map<string, Uint8Array>();
        expect((await runMagickCli(["png:-", "-crop", geometry, output], files, bytes)).exitCode).toBe(0);
        expect(files.size).toBe(tiles.length);
        for (const [index, tile] of tiles.entries()) {
            const actual = decodeImage(await fs.readFile(`/tile-${index}.png`));
            expect(decodeImage(files.get(`/tile-${index}.png`)!)).toEqual(actual);
            const expectedPixels = decodeImage(await sharp(bytes).extract(tile).png().toBuffer());
            expect(actual.data).toEqual(expectedPixels.data);
            expect([actual.width, actual.height]).toEqual([tile.width, tile.height]);
            expect(actual.virtualCanvas).toEqual({ width: 7, height: 5, x: tile.left, y: tile.top });
        }
    });
}
