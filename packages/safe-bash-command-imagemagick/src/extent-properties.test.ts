import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7: a 5x4 RGB grid with red samples 0..19, extended to 7x3.
const cases = [
    { gravity: "NorthWest", red: [0, 1, 2, 3, 4, 255, 255, 5, 6, 7, 8, 9, 255, 255, 10, 11, 12, 13, 14, 255, 255] },
    { gravity: "Center", red: [255, 0, 1, 2, 3, 4, 255, 255, 5, 6, 7, 8, 9, 255, 255, 10, 11, 12, 13, 14, 255] },
    { gravity: "SouthEast", red: [255, 255, 5, 6, 7, 8, 9, 255, 255, 10, 11, 12, 13, 14, 255, 255, 15, 16, 17, 18, 19] },
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    for (const geometry of ["7x3", "%[fx:w+2]x%[fx:h-1]", "%[extent-size]", "%[option:extent-size]"]) {
        it.each(cases)(`expands extent ${geometry} with $gravity gravity (${mode})`, async ({ gravity, red }) => {
            const pixels = Uint8Array.from(Array.from({ length: 20 }, (_, i) => [i, 0, 0]).flat());
            const input = await sharp(pixels, { raw: { width: 5, height: 4, channels: 3 } }).png().toBuffer();
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const argv = ["/in.png", "-background", "white", "-gravity", gravity,
                "-set", "option:extent-size", "7x3", "-extent", geometry,
                "-set", "option:extent-size", "1x1", "PNG24:/out.png"];
            let stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = decodeImage(mode === "command" || mode === "retained"
                ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
            expect([output.width, output.height]).toEqual([7, 3]);
            expect(output.data).toEqual(Uint8Array.from(red.flatMap(value => [value, value === 255 ? 255 : 0, value === 255 ? 255 : 0, 255])));
        });
    }

    it(`expands extent using each image's current dimensions (${mode})`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const argv = ["-size", "5x4", "xc:red", "-size", "8x6", "xc:blue",
            "-extent", "%[fx:w+2]x%[fx:h-1]", "-extent", "%[fx:w+2]x%[fx:h-1]", "/out-%d.png"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        for (const [index, dimensions] of [[9, 2], [12, 4]].entries()) {
            const path = `/out-${index}.png`;
            const output = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile(path) : files.get(path)!);
            expect([output.width, output.height]).toEqual(dimensions);
        }
    });
}
