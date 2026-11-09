import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI PNG32 output, independently decoded as RGBA8.
// Compare all channels, including hidden RGB under zero alpha.
for (const execution of ["command", "buffered", "sync"] as const) {
    it.each([
        {
                "levels": 2,
                "options": [
                        "+dither"
                ],
                "expected": "00000000000000000000000000000000000000000000000000000000000000000000000000ff00ff00ff00ff336666ffff0000ffff0000ffff00ffffffffffffffffffff336666ff336666ff00000000000000000000000000000000000000000000000000000000000000000000000000000000336666ff00ff00ffffffffffff0000ffff00ffffff00ffff"
        },
        {
                "levels": 2,
                "options": [
                        "-dither",
                        "None"
                ],
                "expected": "00000000000000000000000000000000000000000000000000000000000000000000000000ff00ff00ff00ff336666ffff0000ffff0000ffff00ffffffffffffffffffff336666ff336666ff00000000000000000000000000000000000000000000000000000000000000000000000000000000336666ff00ff00ffffffffffff0000ffff00ffffff00ffff"
        },
        {
                "levels": 2,
                "options": [
                        "-alpha",
                        "off",
                        "+dither"
                ],
                "expected": "00ffffff00ff00ffff00ffffff00ffffffff00ffffffffffffffffff000000ff0000ffff00ff00ff00ff00ff00ffffffff0000ffff0000ffff00ffffffff00ffffffffff0000ffff000000ff0000ffff00ffffffffff00ffff00ffffff00ffffff0000ffffffffff00ff00ff000000ff0000ffff000000ff00ff00ffffffffffff0000ffff00ffffff00ffff"
        },
        {
                "levels": 3,
                "options": [
                        "+dither"
                ],
                "expected": "0000000000000000000000000000000080800080ff808080ffffff800000808000808080008000808080808080ff80808000008080808080ff80ffffff8000ffffff80ff0000ffff008000ff0000000000000000000000000000000000000000ff808080ff80808000ff0080000080800080ff80808000808080808080ffff8080000080ff808080ff80ffff"
        },
        {
                "levels": 4,
                "options": [
                        "+dither"
                ],
                "expected": "000000000000000000000000aa55ff55aaaa5555aaaaaa55ffffff55000055550055aa5555aa00aa55aa55aa55ffaaaaaa0000aaaa5555aaaa55aaaaffaa00aaffffaaff0000ffff555555ff000000000000000000000000aa00aa55aa55ff55aa555555ffaaaa5500ff0055000055555555aa55555500aa55aa55aaaaffffaaaa0055aaaa55aaaaff55ffaa"
        },
        {
                "levels": 17,
                "options": [
                        "+dither"
                ],
                "expected": "50afcf1060ef302080208f209f50df30af804040cfaf9f50efdfef60002050702050af704080008060af608f70dfbf9f8f2010afaf5070afbf80cfbfdfaf20cfffdf80df1020dfef305040ef0000000050afcf1080df50209f109f30af50ff40cf806040efafaf5010df1060201070704050bf806080208070af808f8fdfcf9faf1030afbf508fbfdf80efbf"
        }
])(`${execution}: posterizes RGBA at $levels levels: $options`, async ({ levels, options, expected }) => {
        const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjE6NDQ6NTArMDA6MDD8O7+tAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIxOjQ0OjUwKzAwOjAwjWYHEQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMTo0NDo1MCswMDowMNpzJs4AAAAsSURBVAjXY/TaeolX2jgaK2Zkl/LPwCl5pP7MYZySjU885XBK2nkeq8QlCQDNJB50rUa03gAAAABJRU5ErkJggg==", "base64"));
        const fs = new MemoryFileSystem(), files = new Map([["in.png", input]]);
        await fs.writeFile("/in.png", input);
        const args = ["in.png", ...options, "-posterize", String(levels), "PNG32:out.png"];
        const argumentValues = createCommandArguments(args);
        const result = execution === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : execution === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(execution === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect(Buffer.from(output.data).toString("hex")).toBe(expected);
    });
}
