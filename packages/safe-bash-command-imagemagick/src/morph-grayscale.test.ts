import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI: identical gray pixels encoded as grayscale or RGB.
const gray = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAAAAACMmsGiAAAAAmJLR0QA/4ePzL8AAAAHdElNRQfqCwcKDQQuWKRuAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEwOjEzOjA0KzAwOjAwcujevwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMDoxMzowNCswMDowMAO1ZgMAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MTM6MDQrMDA6MDBUoEfcAAAAEElEQVQI12M0YGBgYGJAIQAD9AA4cgw0QQAAAABJRU5ErkJggg==", "base64");
const rgb = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAABmJLR0QA/wD/AP+gvaeTAAAAB3RJTUUH6gsHCg0a1FeZDQAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMS0wN1QxMDoxMzowNCswMDowMHLo3r8AAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTEtMDdUMTA6MTM6MDQrMDA6MDADtWYDAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTExLTA3VDEwOjEzOjI2KzAwOjAwgRpRiAAAABRJREFUCNdjNDAwYIABJgYkgJsDAB0kAJiaNE1aAAAAAElFTkSuQmCC", "base64");
const color = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTA6MTI6NDkrMDA6MDB4t9q7AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDEwOjEyOjQ5KzAwOjAwCepiBwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxMDoxMjo0OSswMDowMF7/Q9gAAAAUSURBVAjXYxRIOMAAA0wMSAA3BwA7tAE4NQU7awAAAABJRU5ErkJggg==", "base64");

for (const mode of ["command", "buffered", "sync"] as const)
for (const encoding of ["gray", "rgb"] as const)
for (const reverse of [false, true])
for (const resize of [false, true])
it(`preserves the first morph frame's colorspace: ${mode}, ${encoding}, reverse=${reverse}, resize=${resize}`, async () => {
    const files = new Map<string, Uint8Array>([["first.png", encoding === "gray" ? gray : rgb], ["color.png", color]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    const inputs = reverse ? ["color.png", "first.png"] : ["first.png", "color.png"];
    const argv = [inputs[0]!, ...(resize ? ["-resize", "2x2!"] : []), inputs[1]!, "-morph", "1", "-delete", "0,2", "-colorspace", "sRGB", "PNG32:out.png"];
    const args = createCommandArguments(argv);
    const result = mode === "sync" ? runMagickCliSync(argv, files)
        : mode === "buffered" ? await runMagickCli(argv, files)
        : await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        });
    expect(result.exitCode).toBe(0);
    const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("out.png")!);
    const pixel = encoding === "gray" && !reverse ? [32, 32, 32, 255] : [32, 72, 120, 255];
    expect([output.width, output.height]).toEqual(resize ? [3, 3] : [4, 4]);
    expect([...output.data]).toEqual(Array.from({ length: output.width * output.height }, () => pixel).flat());
});
