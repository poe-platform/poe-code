import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 keeps the first input's pHYs and properties in the saved PNG.
const plain = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAAEklEQVR4nGO4wyX3HxkzEBQAAGT5GCWP9zVLAAAAAElFTkSuQmCC", "base64");
const tagged = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAYAAAC09K7GAAAACXBIWXMAABdwAAAdTAELDIkPAAAAEklEQVR4nGO4wyX3HxkzEBQAAGT5GCWP9zVLAAAAAElFTkSuQmCC", "base64");
const second = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGPg0rj0H4YZkDkAkmkMEySm8r8AAAAASUVORK5CYII=", "base64");

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        it.each([
            { name: "tagged first", metadata: true, single: false },
            { name: "untagged first", metadata: false, single: false },
            { name: "single tagged image", metadata: true, single: true },
        ])(`${mode}: ${operation} preserves saved metadata and pixels ($name)`, async ({ metadata, single }) => {
            const files = new Map<string, Uint8Array>([["/first.png", metadata ? tagged : plain], ["/second.png", second], ["/tagged.png", tagged]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile(path, bytes);
            const argv = [
                "/first.png", ...(metadata ? ["-set", "label", "first", "-set", "comment", "first comment", "-set", "foo", "first value"] : []),
                ...(single ? [] : ["(", metadata ? "/second.png" : "/tagged.png", "-set", "label", "second", "-set", "comment", "second comment", "-set", "foo", "second value", "-set", "second-only", "absent", ")"]),
                operation, "0", "PNG32:/out.png",
            ];
            const argumentValues = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
            expect.soft(output.resolution).toEqual(metadata ? { x: 6000, y: 7500, unit: "meter" } : undefined);
            expect.soft(output.density).toBe(decodeImage(metadata ? tagged : plain).density);
            expect.soft(output.properties?.label).toBe(metadata ? "first" : undefined);
            expect.soft(output.properties?.comment).toBe(metadata ? "first comment" : undefined);
            expect.soft(output.properties?.foo).toBe(metadata ? "first value" : undefined);
            expect(output.properties?.["second-only"]).toBeUndefined();

            const inputs = [decodeImage(plain), ...(single ? [] : [decodeImage(metadata ? second : tagged)])];
            const vertical = operation === "-smush";
            const width = vertical ? Math.max(...inputs.map(image => image.width)) : inputs.reduce((sum, image) => sum + image.width, 0);
            const height = vertical ? inputs.reduce((sum, image) => sum + image.height, 0) : Math.max(...inputs.map(image => image.height));
            expect([output.width, output.height]).toEqual([width, height]);
            const pixels = new Uint8Array(width * height * 4).fill(255);
            let offset = 0;
            for (const image of inputs) {
                for (let y = 0; y < image.height; y++) {
                    pixels.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + (vertical ? offset : 0)) * width + (vertical ? 0 : offset)) * 4);
                }
                offset += vertical ? image.height : image.width;
            }
            expect(output.data).toEqual(pixels);
        });
    }
}
