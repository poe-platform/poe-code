import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGB8 input with red samples 0..41.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAGCAIAAACAbBMhAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTY6NDE6NTYrMDA6MDB40GJQAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE2OjQxOjU2KzAwOjAwCY3a7AAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNjo0MTo1NiswMDowMF6Y+zMAAAAXSURBVAjXY2RICWBkYEBDLOwYQjQUBQBzYQERsH3HkwAAAABJRU5ErkJggg==", "base64");

// Area geometry scales the requested border dimensions, not the source aspect ratio.
for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["4@", 2, 2], ["2x2@", 1, 1], ["1x2@", 1, 1],
        ["2x1@", 2, 1], ["3x2@", 2, 1], ["4x3@", 2, 2],
        ["1@", 0, 0], ["0@", 0, 0], ["0x0@", 0, 0],
        ["1x1", 1, 1], ["1x2", 1, 2], ["0x0", 0, 0],
    ] as const)(`resolves shave %s before extracting pixels (${mode})`, async (geometry, horizontal, vertical) => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-shave", geometry, "PNG24:/out.png"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained"
            ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        const output = decodeImage(bytes);
        const width = 7 - 2 * horizontal, height = 6 - 2 * vertical;
        expect([output.width, output.height]).toEqual([width, height]);
        expect(runIdentifyCliSync(["-format", "%wx%h %g", "/out.png"], new Map([["/out.png", bytes]])))
            .toMatchObject({ exitCode: 0, stdout: `${width}x${height} ${width}x${height}+0+0`, stderr: "" });
        const expected: number[] = [];
        for (let y = vertical; y < 6 - vertical; y++) for (let x = horizontal; x < 7 - horizontal; x++) {
            expected.push(y * 7 + x, 100, 80, 255);
        }
        expect(output.data).toEqual(Uint8Array.from(expected));
    });
}
