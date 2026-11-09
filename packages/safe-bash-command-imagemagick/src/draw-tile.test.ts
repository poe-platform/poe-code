import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["map", "filesystem", "command"])
for (const fill of ["tile", "red", "reset", "inline-reset"])
for (const alpha of [0, 255])
it(`draws repeated tile colors and composites alpha: ${mode}, ${fill}, alpha=${alpha}`, async () => {
    const colors = [[255, 0, 0, 255], [0, 255, 0, 127], [0, 0, 255, 255], [255, 255, 0, alpha]];
    const tile = await sharp(new Uint8Array(colors.flat()), { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const files = new Map([["tile.png", tile], ["out.png", new TextEncoder().encode("keep")]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile("/" + path, bytes);
    const args = ["-size", "5x3", "xc:white", ...(fill === "red" ? ["-fill", "red"] : ["-tile", "tile.png"]), ...(fill === "reset" ? ["-fill", "red"] : []), "-draw", `${fill === "inline-reset" ? "fill red " : ""}rectangle 0,0 4,2`, "out.png"];
    const argumentValues = createCommandArguments(args);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}, fs: filesystem,
    } as unknown as CommandContext;
    const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const image = decodeImage(mode !== "map" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    expect([image.width, image.height]).toEqual([5, 3]);
    const composited = [[255, 0, 0, 255], [128, 255, 128, 255], [0, 0, 255, 255], [255, 255, 255 - alpha, 255]];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
        const expected = fill === "tile" ? composited[(y % 2) * 2 + x % 2] : [255, 0, 0, 255];
        expect([...image.data.subarray((y * 5 + x) * 4, (y * 5 + x + 1) * 4)]).toEqual(expected);
    }
});
