import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./smush-cmyk-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI: -background <background> a.png b.png
// -colorspace CMYK [+-]smush <gap> -colorspace sRGB PNG32:out.png.
const inputs = [
    ["a.png", "iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NTk6MjArMDA6MDCtCkFTAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjU5OjIwKzAwOjAw3Ff57wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo1OToyMCswMDowMItC2DAAAABQSURBVAjXYxCyFmUw3lCxLET19tfSWXYu0/gXTmZZ6vmeQdHzfbfivve3oLQ/VDC5W7H0vf9Sz/e3FEvfd0MES993K3q+71Ysfe+v6PneHwD1XyWqKvH2yAAAAABJRU5ErkJggg=="],
    ["b.png", "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NTk6MjArMDA6MDCtCkFTAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjU5OjIwKzAwOjAw3Ff57wAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo1OToyMCswMDowMItC2DAAAAA+SURBVAjXATMAzP8AZYKyaIb3FbenbHgGyOHbVQDpVj4ACsuh8ytABEJMtWeRAG0qyuCOny0ArxSQftCJ881aThfK7ZOX+QAAAABJRU5ErkJggg=="],
] as const;

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(fixtures)(`${mode}: $operation composites CMYK inks and alpha with $background background and gap $gap`, async ({ background, operation, gap, width, height, pixels }) => {
        const argv = ["-background", background, "a.png", "b.png", "-colorspace", "CMYK", operation, gap, "-colorspace", "sRGB", "PNG32:out.png"];
        const args = createCommandArguments(argv), fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>(inputs.map(([name, data]) => [name, Buffer.from(data, "base64")]));
        for (const [name, data] of files) await fs.writeFile(`/${name}`, data);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(chunk) { stderr += chunk; } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
        expect([output.width, output.height]).toEqual([width, height]);
        expect(Array.from(output.data)).toEqual(pixels);
    });
}
