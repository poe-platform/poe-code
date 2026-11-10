import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// TIFF IFD0 containing Make, Model and DateTimeOriginal, as in the Pillow repro.
const tags = [[271, "ParityCamera"], [272, "ModelOne"], [36867, "2020:01:02 03:04:05"]] as const;
const exif = new Uint8Array(92);
const view = new DataView(exif.buffer);
exif.set([73, 73, 42, 0, 8, 0, 0, 0]);
view.setUint16(8, tags.length, true);
let offset = 50;
for (const [index, [tag, value]] of tags.entries()) {
    const entry = 10 + index * 12;
    const text = new TextEncoder().encode(value + "\0");
    view.setUint16(entry, tag, true);
    view.setUint16(entry + 2, 2, true);
    view.setUint32(entry + 4, text.length, true);
    view.setUint32(entry + 8, offset, true);
    exif.set(text, offset);
    offset += text.length;
}
const original = decodeImage(readFileSync(new URL("./fixtures/append-icc-tagged.png", import.meta.url)));
const tagged = encodeImage({ ...original, exif }, { format: "png" }).data;
const other = readFileSync(new URL("./fixtures/append-icc-other.png", import.meta.url));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["", "+append", "-append"]) {
        it.each([
            { name: "tagged first", inputs: ["tagged.png", "other.png"], options: [], keepExif: true, keepIcc: true },
            { name: "untagged first", inputs: ["other.png", "tagged.png"], options: [], keepExif: false, keepIcc: false },
            { name: "single tagged", inputs: ["tagged.png"], options: [], keepExif: true, keepIcc: true },
            { name: "stripped", inputs: ["tagged.png", "other.png"], options: ["-strip"], keepExif: false, keepIcc: false },
            { name: "removed EXIF", inputs: ["tagged.png", "other.png"], options: ["+profile", "exif"], keepExif: false, keepIcc: true },
        ].filter(({ inputs }) => operation !== "" || inputs.length === 1))(`${mode}: ${operation || "rewrite"} retains first-input EXIF ($name)`, async ({ inputs, options, keepExif, keepIcc }) => {
            const files = new Map<string, Uint8Array>([["tagged.png", tagged], ["other.png", other]]);
            const fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
            const argv = [...inputs, ...(operation ? [operation] : []), ...options, "PNG32:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            const images = inputs.map(input => decodeImage(files.get(input)!));
            expect([output.width, output.height]).toEqual(operation === "+append"
                ? [images.reduce((sum, image) => sum + image.width, 0), Math.max(...images.map(image => image.height))]
                : [Math.max(...images.map(image => image.width)), images.reduce((sum, image) => sum + image.height, 0)]);
            expect(output.icc).toEqual(keepIcc ? original.icc : undefined);
            expect(output.exif).toEqual(keepExif ? exif : undefined);
        });
    }
}
