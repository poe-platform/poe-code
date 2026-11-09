import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: one.png +dither -channel <mask>
// -posterize 3 +channel PNG32:out.png, decoded with -depth 8 rgba:-.
// The input is PNG color type 4 (GrayAlpha), with an opaque gray sample of 110.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAAmJLR0QA/4ePzL8AAAAHdElNRQfqCwcXFgXkl29BAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDIzOjIyOjA1KzAwOjAwYxSRIQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QyMzoyMjowNSswMDowMBJJKZ0AAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMjM6MjI6MDUrMDA6MDBFXAhCAAAAC0lEQVQI12PI+w8AAd4BbrwfdGMAAAAASUVORK5CYII=", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { channel: "R", options: [], expected: [128, 128, 128, 255] },
        { channel: "G", options: [], expected: [110, 110, 110, 255] },
        { channel: "B", options: [], expected: [110, 110, 110, 255] },
        { channel: "RA", options: [], expected: [128, 128, 128, 255] },
        { channel: "RGB", options: [], expected: [128, 128, 128, 255] },
        { channel: "A", options: [], expected: [110, 110, 110, 255] },
        { channel: "R", options: ["-colorspace", "sRGB"], expected: [128, 110, 110, 255] },
        { channel: "G", options: ["-colorspace", "sRGB"], expected: [110, 128, 110, 255] }
    ])(`${mode}: posterizes logical gray channels for $channel $options`, async ({ channel, options, expected }) => {
        const files = new Map<string, Uint8Array>([["one.png", input]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/one.png", input);
        const argv = ["one.png", ...options, "+dither", "-channel", channel, "-posterize", "3", "+channel", "PNG32:out.png"];
        const argumentValues = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
