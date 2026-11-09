import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        it.each([
            { background: "none", pixel: [0, 0, 0, 0] },
            { background: "#12345680", pixel: [18, 52, 86, 128] },
            { background: "white", pixel: [255, 255, 255, 255] },
        ])(`${mode}: ${operation} preserves $background gaps between opaque images`, async ({ background, pixel }) => {
            const argv = ["-size", "2x2", "xc:red", "-size", "1x1", "xc:blue", "-background", background, operation, "1", "PNG32:out.png"];
            const args = createCommandArguments(argv), fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            const actual = decodeImage(output), red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
            expect([actual.width, actual.height]).toEqual(operation === "+smush" ? [4, 2] : [2, 4]);
            // Native ImageMagick RGBA8 raster, including padding beside the smaller image.
            const pixels = operation === "+smush"
                ? [red, red, pixel, blue, red, red, pixel, pixel]
                : [red, red, red, red, pixel, pixel, blue, pixel];
            expect(Array.from(actual.data)).toEqual(pixels.flat());
        });
    }
}
