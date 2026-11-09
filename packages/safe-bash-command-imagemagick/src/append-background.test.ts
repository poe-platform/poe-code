import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const meta = readFileSync(new URL("./fixtures/append-background-meta.png", import.meta.url));
const other = readFileSync(new URL("./fixtures/append-background-other.png", import.meta.url));
// Native ImageMagick 7.1.2-35 Q16-HDRI: magick meta.png other.png +append out.png.
const reference = decodeImage(readFileSync(new URL("./fixtures/append-background-out.png", import.meta.url)));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+append", "-append"]) {
        it.each([
            { name: "first PNG background", reverse: false, background: undefined, strip: false, padding: [255, 255, 0, 255] },
            { name: "reversed first PNG background", reverse: true, background: undefined, strip: false, padding: [0, 255, 255, 255] },
            { name: "explicit black", reverse: false, background: "black", strip: false, padding: [0, 0, 0, 255] },
            { name: "explicit transparency", reverse: false, background: "none", strip: false, padding: [0, 0, 0, 0] },
            { name: "white without stored background", reverse: false, background: undefined, strip: true, padding: [255, 255, 255, 255] },
        ])(`${mode}: ${operation} uses $name`, async ({ reverse, background, strip, padding }) => {
            const { backgroundColor: ignoredBackground, ...image } = decodeImage(meta);
            const first = strip ? encodeImage(image, { format: "png" }).data : meta;
            if (strip) expect(decodeImage(first).backgroundColor).toBeUndefined();
            const files = new Map<string, Uint8Array>([["meta.png", first], ["other.png", other]]), fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
            const inputs = reverse ? ["other.png", "meta.png"] : ["meta.png", "other.png"];
            const argv = [...inputs, ...(background === undefined ? [] : ["-background", background]), operation, "PNG32:out.png"];
            const args = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            const images = inputs.map(path => decodeImage(files.get(path)!));
            const vertical = operation === "-append";
            const width = vertical ? Math.max(...images.map(image => image.width)) : images.reduce((sum, image) => sum + image.width, 0);
            const height = vertical ? images.reduce((sum, image) => sum + image.height, 0) : Math.max(...images.map(image => image.height));
            const expected = Uint8Array.from(Array.from({ length: width * height }, () => padding).flat());
            let offset = 0;
            for (const image of images) {
                for (let y = 0; y < image.height; y++) {
                    expected.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), ((y + (vertical ? offset : 0)) * width + (vertical ? 0 : offset)) * 4);
                }
                offset += vertical ? image.height : image.width;
            }
            expect([output.width, output.height]).toEqual([width, height]);
            expect(output.data).toEqual(expected);
            if (!vertical && !reverse && !strip && background === undefined) expect(output.data).toEqual(reference.data);
        });
    }
}
