import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const [geometry, tileWidth, tileHeight, single] of [["3x2", 3, 2, false], ["50%", 3, 2, false], ["0x2", 5, 2, false], ["2x2!", 2, 2, false], ["2x2+0+0", 2, 2, true]] as const) {
    it(`preserves every patterned crop tile for ${geometry}`, async () => {
        const pixels = Uint8Array.from({ length: 5 * 4 * 3 }, (_, i) => i * 3);
        const bytes = await sharp(pixels, { raw: { width: 5, height: 4, channels: 3 } }).png().toBuffer();
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
        for (let top = 0; top < (single ? 1 : 4); top += tileHeight)
            for (let left = 0; left < (single ? 1 : 5); left += tileWidth)
                tiles.push({ left, top, width: Math.min(tileWidth, 5 - left), height: Math.min(tileHeight, 4 - top) });
        const expected = tiles.map(t => `${t.width}x${t.height}+${t.left}+${t.top}\n`).join("");
        expect(await execute("info:")).toBe(expected);
        expect((await runMagickCli(["png:-", "-crop", geometry, "-format", "%wx%h%X%Y\\n", "info:"], new Map(), bytes)).stdout).toBe(expected);
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
            expect(actual.virtualCanvas).toEqual({ width: 5, height: 4, x: tile.left, y: tile.top });
        }
    });
}
