import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["map", "filesystem", "command"])
for (const [x, y, reset] of [[0, 0, false], [1, 0, false], [-1, 0, false], [3, 1, false], [-3, -1, false], [9, 9, false], [1, 1, true]] as const)
it(`tiles with offset ${x},${y}, reset=${reset}, mode=${mode}`, async () => {
    const colors = [[255, 0, 0, 255], [0, 255, 0, 127], [0, 0, 255, 255], [255, 255, 0, 255]];
    const tile = await sharp(new Uint8Array(colors.flat()), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const files = new Map([["tile.png", tile], ["out.png", new TextEncoder().encode("keep")]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile("/" + path, bytes);
    const offset = `${x < 0 ? "" : "+"}${x}${y < 0 ? "" : "+"}${y}`;
    const args = ["-size", "5x3", "-tile-offset", offset, ...(reset ? ["+tile-offset"] : []), "tile:tile.png", "out.png"];
    const argumentValues = createCommandArguments(args);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs: filesystem,
    } as unknown as CommandContext;
    const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const image = decodeImage(mode !== "map" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    expect([image.width, image.height]).toEqual([5, 3]);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) {
        const sx = col - (reset ? 0 : x), sy = row - (reset ? 0 : y);
        const expected = sx < 0 || sy < 0 || sx >= 5 || sy >= 3 ? [0, 0, 0, 0] : colors[(sy % 2) * 2 + sx % 2];
        expect([...image.data.subarray((row * 5 + col) * 4, (row * 5 + col + 1) * 4)]).toEqual(expected);
    }
});
