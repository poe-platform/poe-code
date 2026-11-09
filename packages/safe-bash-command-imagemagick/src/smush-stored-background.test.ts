import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const first = readFileSync(new URL("./fixtures/smush-background-a.png", import.meta.url));
const second = readFileSync(new URL("./fixtures/smush-background-b.png", import.meta.url));
// ImageMagick 7.1.2-35 Q16-HDRI: magick a.png b.png +smush 0 PNG32:out.png.
const reference = decodeImage(readFileSync(new URL("./fixtures/smush-background-out.png", import.meta.url)));

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const operation of ["+smush", "-smush"]) {
        it.each([
            { name: "stored cyan", background: undefined, stored: true, pixel: [112, 143, 135, 255] },
            { name: "explicit cyan", background: "cyan", stored: true, pixel: [112, 143, 135, 255] },
            { name: "explicit white", background: "white", stored: true, pixel: [239, 143, 135, 255] },
            { name: "explicit transparency", background: "none", stored: true, pixel: [224, 32, 16, 128] },
            { name: "white fallback", background: undefined, stored: false, pixel: [239, 143, 135, 255] },
        ])(`${mode}: ${operation} composites onto $name`, async ({ background, stored, pixel }) => {
            const { backgroundColor: ignoredBackground, ...image } = decodeImage(first);
            const input = stored ? first : encodeImage(image, { format: "png" }).data;
            expect(decodeImage(input).backgroundColor).toEqual(stored ? { r: 0, g: 255, b: 255, a: 255 } : undefined);
            const files = new Map<string, Uint8Array>([["a.png", input], ["b.png", second]]), fs = new MemoryFileSystem();
            for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
            const argv = ["a.png", "b.png", ...(background === undefined ? [] : ["-background", background]), operation, "0", "PNG32:out.png"];
            const args = createCommandArguments(argv);
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!);
            expect([output.width, output.height]).toEqual(operation === "+smush" ? [5, 4] : [4, 5]);
            expect([...output.data.subarray(0, 4)]).toEqual(pixel);
            if (operation === "+smush" && stored && (background === undefined || background === "cyan")) {
                expect(output.data).toEqual(reference.data);
            }
        });
    }
}
