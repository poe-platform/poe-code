import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Original 4x2 RGBA8 fixture; expected pixels from ImageMagick 7.1.2-35 Q16-HDRI,
// writing PNG32 then decoding with -depth 8 rgba:-.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDI6MTE6NTErMDA6MDAffBxGAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAyOjExOjUxKzAwOjAwbiGk+gAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMjoxMTo1MSswMDowMDk0hSUAAAArSURBVAjXY6hvaNRvOPHhhJaJ2//FwhEpLE/F3C9u9pSeaRFRLyrDo9oKAAKLDYJuAVXgAAAAAElFTkSuQmCC", "base64");
const cases = [
    {
        name: "regional",
        options: ["-region", "2x1+1+0"],
        expected: [
            43, 43, 43, 47, 128, 55, 15, 55, 42, 52, 70, 0, 86, 12, 55, 100,
            0, 0, 0, 0, 14, 10, 7, 97, 70, 93, 122, 221, 175, 59, 160, 233,
        ],
    },
    {
        name: "unmasked",
        options: [],
        expected: [
            127, 128, 126, 47, 128, 55, 15, 55, 42, 52, 70, 0, 92, 19, 88, 100,
            100, 105, 55, 0, 23, 17, 11, 97, 79, 105, 117, 34, 64, 64, 80, 22,
        ],
    },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each(cases)(`matches every native solarize pixel with translucent input: $name (${mode})`, async ({ options, expected }) => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...options, "-solarize", "32896", "+region", "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([4, 2]);
        expect([...output.data]).toEqual(expected);
    });
}
