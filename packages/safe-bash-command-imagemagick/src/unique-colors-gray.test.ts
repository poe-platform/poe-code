import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Synthetic 9x3 RGBA8 input; expected palette from ImageMagick Q16-HDRI.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAADCAYAAABBCiV2AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NTE6MzIrMDA6MDDl6BAQAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjUxOjMyKzAwOjAwlLWorAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo1MTozMiswMDowMMOgiXMAAABWSURBVAjXY9QIqPjPQACwwBjX17czMDIyMjCckAvk8mFY//XNQ4bk6ScZmQxLTjBsSbnTIKJh8/+ECAND8rQTDBoBFf//////n4GB4T/DCbkALhG5/wAFcRwZ6JnTkgAAAABJRU5ErkJggg==", "base64");
const expected = [
    [0x390e, 0], [0x8fd3, 0], [0x8f52, 0], [0x91c4, 0x5050],
    [0x7e2a, 0x8080], [0, 0xffff], [0x12ab, 0xffff], [0x2556, 0xffff],
    [0x48eb, 0xffff], [0x4aac, 0xffff], [0xa949, 0xc8c8], [0xffff, 0xffff],
].flatMap(([gray, alpha]) => [gray!, gray!, gray!, alpha!]);

for (const mode of ["sync", "map", "retained", "command"]) for (const depth of [8, 16]) {
    it(`keeps distinct grayscale colors before output rounding (${mode}, depth=${depth})`, async () => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-colorspace", "Gray", "-unique-colors", "-colorspace", "sRGB", `PNG${depth * 4}:/out.png`];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "map" ? files : { filesystem, cwd: "/" });
            expect(result.exitCode, result.stderr).toBe(0);
        }
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([12, 1]);
        expect(Array.from(depth === 16 ? output.data16! : output.data)).toEqual(
            depth === 16 ? expected : expected.map(value => Math.round(value / 257)));
    });
}
