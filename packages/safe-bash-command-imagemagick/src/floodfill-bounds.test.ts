import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["-floodfill", "color", "alpha"] as const) {
        it.each([[4, 0], [-1, 0], [0, 2], [0, -1], [0, 0]])(`${mode}: ${operation} seed %i,%i respects canvas bounds`, async (x, y) => {
            const white = [255, 255, 255, 255], black = [0, 0, 0, 255];
            const pixels = [...white, ...white, ...black, ...white, ...white, ...black, ...black, ...white];
            const input = encodeImage({ width: 4, height: 2, data: Uint8Array.from(pixels),
                format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
            }, { format: "png" }).data;
            const previous = new TextEncoder().encode("keep");
            const files = new Map([["in.png", input], ["out.png", previous]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            await fs.writeFile("/out.png", previous);
            const argv = ["in.png", "-fill", operation === "alpha" ? "none" : "red", ...(operation === "-floodfill"
                ? ["-floodfill", `${x < 0 ? "" : "+"}${x}${y < 0 ? "" : "+"}${y}`, "white"]
                : ["-draw", `${operation} ${x},${y} floodfill`]), "PNG32:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            const outside = x < 0 || y < 0 || x >= 4 || y >= 2;
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            if (outside && operation !== "-floodfill") {
                expect(result.exitCode).not.toBe(0);
                expect(output).toEqual(previous);
            } else {
                expect(result.exitCode).toBe(0);
                const fill = operation === "alpha" ? [255, 255, 255, 0] : [255, 0, 0, 255];
                expect([...decodeImage(output).data]).toEqual(outside ? pixels
                    : [...fill, ...fill, ...black, ...white, ...fill, ...black, ...black, ...white]);
            }
        });
    }
}
