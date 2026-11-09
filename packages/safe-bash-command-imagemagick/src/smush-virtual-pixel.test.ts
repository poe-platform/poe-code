import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./smush-virtual-pixel-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: original PNG inputs and decoded native PNG32 outputs.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        it.each([
            { method: "tile", widths: [5, 5] },
            { method: "background", widths: [6, 6] },
            { method: "white", widths: [6, 6] },
            { method: "black", widths: [6, 6] },
            { method: "gray", widths: [6, 6] },
            { method: "edge", widths: [4, 4] },
            { method: "transparent", widths: [4, 4] },
            { method: "mirror", widths: [4, 4] },
            { method: "reset", widths: [4, 4] },
            { method: "horizontal-tile", widths: [6, 5] },
            { method: "vertical-tile", widths: [5, 6] },
            { method: "checker-tile", widths: [6, 6] },
            { method: "horizontal-tile-edge", widths: [4, 5] },
            { method: "vertical-tile-edge", widths: [5, 4] },
            { method: "background", widths: [4, 4], background: "none" },
            { method: "checker-tile", widths: [4, 4], background: "none" },
        ])(`${mode} ${operation} honors $method virtual pixels ($background background)`, async ({ method, widths, background = "white" }) => {
            const files = new Map([ ["left.png", Uint8Array.from(Buffer.from(fixtures.left, "base64"))], ["right.png", Uint8Array.from(Buffer.from(fixtures.right, "base64"))] ]);
            const fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
            const argv = ["-background", background, "-virtual-pixel", method === "reset" ? "tile" : method, ...(method === "reset" ? ["+virtual-pixel"] : []),
                "left.png", "right.png", ...(operation === "-smush" ? ["-transpose"] : []), operation, "0", "PNG32:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const actual = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            const width = widths[operation === "+smush" ? 0 : 1]!;
            const pixels = width === 4 ? Array.from({ length: 4 * 4 * 4 }, () => background === "none" ? 0 : 255)
                : (width === 5 ? fixtures.tile : fixtures.background).pixels;
            if (width === 4) {
                pixels.splice(2 * 4, 4, ...(background === "none" ? [30, 180, 200, 128] : [142, 217, 227, 255]));
                pixels.splice((2 * 4 + 2) * 4, 4, 200, 40, 20, 255);
                pixels.splice((3 * 4 + 1) * 4, 4, 200, 40, 20, 255);
            }
            expect([actual.width, actual.height]).toEqual(operation === "+smush" ? [width, 4] : [4, width]);
            const expected = operation === "+smush" ? pixels : Array.from({ length: pixels.length }, (_, i) => {
                const pixel = Math.floor(i / 4), x = pixel % 4, y = Math.floor(pixel / 4);
                return pixels[(x * width + y) * 4 + i % 4]!;
            });
            expect([...actual.data]).toEqual(expected);
        });
    }
}
