import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, RGBA PNG input, -sepia-tone 80%, PNG32 output.
// Expected samples decoded independently with native -depth 8 rgba:-.
const input = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDA6MDE6MDMrMDA6MDBh0WmAAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAwOjAxOjAzKzAwOjAwEIzRPAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMDowMTowMyswMDowMEeZ8OMAAAETSURBVBjTAQgB9/4AJXjLHo7hNIf3Sp3wYLMGWckcb8Iyhdgrm+5BlARXqv0AbcATZtYpfM8/kuU4qPtOoRFktwp6zSBz4zaJ3Eyf8kUAtQhbrh5xxBeH2i2A8EOW6Vms/1LCFWi7K37RJJTnOo0A/VCj9ma5DF/PInXIOIveMaH0R5oKXbADc8YZbNwvgtUARZjrPq4BVKcXar0QgNMmeek8j+JSpfhLuw5htCR3yh0AjeAzhvZJnO9fsgVYyBtuwTGE1yqa7UCTA1ap/Gy/EmUA1Sh7zj6R5Den+k2gEGO2CXnMH3LiNYjbS57xRLQHWq0AHXDDFobZLH/vQpXoWKv+UcEUZ7oqfdAjk+Y5jPxPovUcJoEBTbp3hAAAAABJRU5ErkJggg=="), character => character.charCodeAt(0));
const expected = [
    137, 84, 5, 0, 255, 215, 137, 98, 153, 99, 18, 255, 210, 155, 71, 27,
    65, 21, 0, 188, 162, 108, 26, 0, 255, 235, 157, 117, 74, 28, 0, 255,
    229, 174, 91, 47, 89, 41, 0, 208, 186, 131, 47, 0, 255, 255, 177, 137,
    98, 49, 0, 0, 244, 190, 110, 67, 114, 63, 0, 228, 208, 152, 69, 0,
    34, 0, 0, 157, 123, 71, 0, 0, 255, 205, 126, 87, 140, 87, 7, 248,
    227, 172, 89, 16, 54, 12, 0, 177, 149, 95, 14, 0, 255, 224, 146, 107,
    165, 110, 28, 255, 219, 164, 81, 36, 76, 30, 0, 197, 173, 118, 36, 0,
    255, 244, 166, 127, 85, 37, 0, 0, 236, 182, 100, 56, 101, 51, 0, 217,
    196, 141, 57, 0, 24, 0, 0, 147, 109, 59, 0, 0, 250, 197, 118, 76,
    126, 74, 0, 237, 217, 162, 78, 6, 42, 3, 0, 166, 135, 82, 3, 0,
    255, 214, 136, 96, 151, 98, 17, 255, 209, 153, 70, 26, 64, 20, 0, 186,
    160, 106, 24, 0, 255, 234, 156, 116, 72, 27, 0, 255, 228, 173, 90, 45,
    87, 40, 0, 206, 184, 129, 46, 0, 255, 254, 175, 136, 96, 47, 0, 0,
    243, 189, 109, 65, 112, 62, 0, 226, 206, 151, 67, 0, 32, 0, 0, 156,
    121, 70, 0, 0, 255, 203, 125, 85, 138, 85, 5, 246, 226, 170, 88, 15,
    52, 10, 0, 176, 147, 93, 13, 0, 255, 223, 145, 105, 163, 108, 26, 255,
];

for (const mode of ["buffered", "sync", "retained", "command"] as const) {
    it.each([
        ["implicit default", []],
        ["explicit Default", ["-channel", "Default"]],
        ["reset channels", ["-channel", "RGB", "+channel"]],
    ] as const)(`${mode}: normalizes sepia RGB and alpha together with %s`, async (_name, channels) => {
        const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", input);
        const argv = ["/in.png", ...channels, "-sepia-tone", "80%", "+channel", "PNG32:/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write() {} }, stderr: { async write() {} },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        expect(Array.from(decodeImage(output).data)).toEqual(expected);
    });
}
