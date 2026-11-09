import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native PNG48: 7x6 opaque pixels, starting with RGB16 0007/2345/abcd.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAAGEAIAAADQ/M9iAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMTY6NDQ6MzArMDA6MDA7RpWpAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDE2OjQ0OjMwKzAwOjAwShstFQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QxNjo0NDozMCswMDowMB0ODMoAAAA4SURBVBjTY2RgV3ZdfZb5BQMDAwMLflI6goGBgYElAl2CGadSTAlMcZkIHGYQ7wAszsDpAAxnAACZeiMpp+b4ZgAAAABJRU5ErkJggg==", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { geometry: undefined, left: 0, top: 0 },
        { geometry: "0x0", left: 0, top: 0 },
        { geometry: "2x2", left: 2, top: 2 },
        { geometry: "2x2+1+1", left: 2, top: 2 },
        { geometry: "1023x2+1+1", left: 1023, top: 2 },
    ])(`${mode}: preserves every RGB16 source sample inside frame $geometry`, async ({ geometry, left, top }) => {
        const argv = ["in.png", "-mattecolor", "#4275ac", ...(geometry ? ["-frame", geometry] : []), "PNG48:out.png"];
        const files = new Map<string, Uint8Array>([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result, stderr).toMatchObject({ exitCode: 0 });
        const image = decodeImage(mode === "command" || mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([image.width, image.height]).toEqual([7 + left * 2, 6 + top * 2]);
        const source = decodeImage(input);
        expect([...source.data16!.slice(0, 4)]).toEqual([0x0007, 0x2345, 0xabcd, 0xffff]);
        expect(image.data16).toBeDefined();
        for (let y = 0; y < source.height; y++) {
            const offset = ((y + top) * image.width + left) * 4;
            expect([...image.data16!.slice(offset, offset + source.width * 4)]).toEqual([...source.data16!.slice(y * source.width * 4, (y + 1) * source.width * 4)]);
        }
    });
}
