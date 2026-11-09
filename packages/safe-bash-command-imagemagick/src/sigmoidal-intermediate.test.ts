import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI restores every byte of this 8-bit RGBA ramp
// after either order of -sigmoidal-contrast 4x50% and +sigmoidal-contrast 4x50%.
const ramp = decodeImage(Uint8Array.from(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjE6NTQ6MTArMDA6MDC5/26XAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIxOjU0OjEwKzAwOjAwyKLWKwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMTo1NDoxMCswMDowMJ+39/QAAACNSURBVDjLY2SQ52dkZJflJRezCBRcuIAQeIsDX8ApDzUARdEF/IbIYjGgAK+iC/gMQnIBYdtQDYOqCfCXF6RSIBIKQBxqCvT3b6SCC3BG1wWCUTqBPz6Qii4gwe/sby8wsl/gZdzw/v9HSlzAeCD+/EEqeQHFyUR7C0sYIIVyAbJ/sashNSmjBiC7LC8AJFm2GQtr1fcAAAAASUVORK5CYII=",
    "base64"
)));
// Cross retained-storage chunk boundaries as well as exercising the original ramp.
const pixels = Uint8Array.from([...ramp.data, ...ramp.data, ...ramp.data]);
const input = encodeImage({ ...ramp, height: ramp.height * 3, data: pixels }, { format: "png" }).data;

// Native output samples for input values 0..255 after two forward 4x25% operations.
const repeated = Buffer.from(
    "AAEDBAUHCAoLDQ4QERMVFhgaGx0fICIkJigpKy0vMTM1Nzk7PT9BQ0VHSUtNT1FTVVhaXF5gYmRmaWttb3FzdXd5e31/gYOFh4mLjY+Rk5WXmZqcnqCio6WnqKqsra+wsrO1tri5u7y9v8DBw8TFxsfJysvMzc7P0NHS09TV1tfY2dna29zd3d7f4ODh4uLj5OTl5ebn5+jo6enq6uvr7Ozt7e3u7u/v7/Dw8fHx8vLy8/Pz8/T09PX19fX29vb29/f39/f4+Pj4+fn5+fn5+vr6+vr6+/v7+/v7+/z8/Pz8/Pz8/f39/f39/f39/v7+/v7+/v7+/v7+/////////w==",
    "base64"
);

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const [first, second, geometry, lookup] of [
        ["-sigmoidal-contrast", "+sigmoidal-contrast", "4x50%", undefined],
        ["+sigmoidal-contrast", "-sigmoidal-contrast", "4x50%", undefined],
        ["-sigmoidal-contrast", "-sigmoidal-contrast", "4x25%", repeated]
    ] as const) {
        it.each([undefined, "RGB", "R", "A"])(`${mode}: preserves intermediate precision with ${first} then ${second} ${geometry} and channel %s`, async channel => {
            const argv = ["in.png", ...(channel ? ["-channel", channel] : []),
                first, geometry, second, geometry, "PNG32:out.png"];
            const files = new Map([["in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
            expect(output[24]).toBe(8);
            const expected = pixels.map((value, index) =>
                lookup && (channel ?? "RGBA").includes("RGBA"[index % 4]!) ? lookup[value]! : value);
            expect(decodeImage(output).data).toEqual(expected);
        });
    }
}
