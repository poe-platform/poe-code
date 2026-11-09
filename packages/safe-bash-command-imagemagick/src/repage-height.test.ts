import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// Native ImageMagick input: 4x3 pixels on a 10x9+3+2 canvas.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTg6NDU6NDMrMDA6MDAVT+GjAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE4OjQ1OjQzKzAwOjAwZBJZHwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxODo0NTo0MyswMDowMDMHeMAAAAAQY2FOdgAAAAoAAAAJAAAAAwAAAAJsZOwtAAAAGklEQVQI12NkYOcThQGWkJAQOIdxxfptcA4AWb0FXC5SJiUAAAAASUVORK5CYII=", "base64");

for (const mode of ["public", "sync"] as const) {
    it.each([
        ["x8", 10, 9, 3, 2],
        ["x18", 10, 9, 3, 2],
        ["x8+1+2", 10, 9, 1, 2],
        ["x8+1+2!", 10, 9, 4, 4],
        ["0x8", 0, 8, 3, 2],
        ["8", 8, 8, 3, 2],
    ] as const)(`preserves native repage dimensions for %s (${mode})`, async (geometry, width, height, x, y) => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", input);
        const files = new Map<string, Uint8Array>([["/input.png", input]]);
        const args = ["/input.png", "-repage", geometry, "/out.png"];
        const argumentValues = createCommandArguments(args);
        const context = {
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
        } as unknown as CommandContext;
        const result = mode === "public" ? await createMagickCommand().execute(context) : runConvertCliSync(args, files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect(output.virtualCanvas).toEqual({ width, height, x, y });
        expect([output.width, output.height]).toEqual([4, 3]);
        expect(output.data).toEqual(decodeImage(input).data);
    });
}
