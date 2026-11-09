import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const inputs: [string, Buffer][] = [["a.png", "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NTk6MjArMDA6MDCtCkFTAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjU5OjIwKzAwOjAw3Ff57wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo1OToyMCswMDowMItC2DAAAABQSURBVAjXYxCyFmUw3lCxLET19tfSWXYu0/gXTmZZ6vmeQdHzfbfivve3oLQ/VDC5W7H0vf9Sz/e3FEvfd0MES993K3q+71Ysfe+v6PneHwD1XyWqKvH2yAAAAABJRU5ErkJggg=="], ["b.png", "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NTk6MjArMDA6MDCtCkFTAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjU5OjIwKzAwOjAw3Ff57wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo1OToyMCswMDowMItC2DAAAAA+SURBVAjXATMAzP8AZYKyaIb3FbenbHgGyOHbVQDpVj4ACsuh8ytABEJMtWeRAG0qyuCOny0ArxSQftCJ881aThfK7ZOX+QAAAABJRU5ErkJggg=="]].map(([name, data]) => [name!, Buffer.from(data!, "base64")]);

// Native ImageMagick 7.1.2-31 Q16-HDRI, PNG32 output decoded as RGBA8.
const cases = [
    {
        "name": "+smush three overlaps",
        "args": [
            "a.png",
            "b.png",
            "a.png",
            "+smush",
            "-4"
        ],
        "rgba": "000000003ba981ed552bd5ff779840799e31aae100000000d8f96759869bb6fc1bdb2bf8489e71a900000000793c71fd9eb7b916b9224bc9dc9a9ff900000000228b457a4300a8d464750bfc85ea6e5d"
    },
    {
        "name": "+smush later level",
        "args": [
            "a.png",
            "b.png",
            "+smush",
            "-2",
            "-level",
            "40%,60%"
        ],
        "rgba": "0000000000ff5aff0000ffff11addad3afff00ffff1e5a00ffffff0000000000ffff0500ff28ff8200ff00ff00ffffff0000000000ff05d700000000730000ffffffff003600ffffffff7dffff00d278ffafffff0000000000b900000000fff0004b00ff9bff28000000000000000000"
    },
    {
        "name": "-smush three overlaps",
        "args": [
            "a.png",
            "b.png",
            "a.png",
            "-smush",
            "-4"
        ],
        "rgba": "6582b2688aec36eba94bd1fa29e03ae8851d9ea000000000606569fca4617da56b8d3df2d79d80b36d2acae05e5b50cf5f07a2cc6e761efcc7b57abb"
    },
    {
        "name": "-smush later level",
        "args": [
            "a.png",
            "b.png",
            "-smush",
            "-2",
            "-level",
            "40%,60%"
        ],
        "rgba": "0000000000ff5aff0000ffff4bff0000f000ffe100000000ffff0500ff28ff8200ff00ff0000d200008cff0a96ff00ffffffff00fff1bed7ffff7dff0000000000ffffff000019ff00ff00ff9bff28002300ffff00000000ff00d278ffafffff00000000"
    }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: $name retains compositing precision`, async ({ args: operations, rgba }) => {
        const files = new Map(inputs), fs = new MemoryFileSystem();
        for (const [name, input] of inputs) await fs.writeFile("/" + name, input);
        const argv = ["-background", "none", ...operations, "PNG32:out.png"];
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        const actual = decodeImage(output);
        expect(Buffer.from(actual.data).toString("hex")).toBe(rgba);
    });
}
