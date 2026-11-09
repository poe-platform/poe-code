import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -size 6x1 -depth 8 rgba:-
// [channel options] -equalize +channel -depth 8 rgba:-
const input = [10, 40, 220, 32, 20, 40, 160, 64, 20, 40, 130, 96, 50, 40, 130, 128, 100, 40, 90, 192, 200, 40, 60, 224];
const rgb = [43, 255, 255, 32, 128, 255, 213, 64, 128, 255, 170, 96, 170, 255, 170, 128, 213, 255, 85, 192, 255, 255, 43, 224];
const rgbSync = [0, 0, 255, 32, 0, 0, 255, 64, 0, 0, 255, 96, 170, 0, 255, 128, 255, 0, 255, 192, 255, 0, 213, 224];
const rgbaSync = [0, 0, 255, 0, 0, 0, 255, 213, 0, 0, 255, 255, 170, 0, 255, 255, 255, 0, 255, 255, 255, 0, 213, 255];
const rgba = [43, 255, 255, 43, 128, 255, 213, 85, 128, 255, 170, 128, 170, 255, 170, 170, 213, 255, 85, 213, 255, 255, 43, 255];
const cases = [
    { options: ["-channel", "RGB,Sync"], expected: rgbSync },
    { options: ["-channel", "RGBA,Sync"], expected: rgbaSync },
    { options: ["-channel", "R,G,Sync"], expected: [0, 0, 220, 32, 0, 0, 160, 64, 0, 0, 130, 96, 170, 0, 130, 128, 255, 0, 90, 192, 255, 0, 60, 224] },
    { options: ["-channel", "A,Sync"], expected: [10, 40, 220, 0, 20, 40, 160, 213, 20, 40, 130, 255, 50, 40, 130, 255, 100, 40, 90, 255, 200, 40, 60, 255] },
    { options: ["-channel", "Sync"], expected: input },
    { options: ["-channel", "RGB"], expected: rgb },
    { options: ["-channel", "RGB,Sync,!Sync"], expected: rgb },
    { options: ["-channel", "Sync|RGB"], expected: rgbSync },
    { options: ["-channel", "Default"], expected: rgbaSync },
    { options: ["-channel", "Default,!Sync"], expected: rgba },
    { options: ["-channel", "All"], expected: rgba },
    { options: ["-channel", "RGB,Sync", "-channel", "RGB"], expected: rgb },
    { options: ["-channel", "RGB", "+channel"], expected: rgbaSync },
];

for (const opaque of [false, true]) {
    for (const mode of ["buffered", "retained", "sync", "command"] as const) {
        it.each(cases)(`equalizes selected channels via ${mode} (opaque=${opaque}): $options`, async ({ options, expected }) => {
            const pixels = Uint8Array.from(input, (value, index) => opaque && index % 4 === 3 ? 255 : value);
            const source = await sharp(pixels, { raw: { width: 6, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["/in.png", source]]), fs = createMemoryFileSystem();
            await fs.writeFile("/in.png", source);
            const args = ["/in.png", ...options, "-equalize", "+channel", "PNG32:/out.png"];
            let stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect(result.exitCode).toBe(0);
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
            expect([...decodeImage(output).data]).toEqual(expected.map((value, index) => opaque && index % 4 === 3 ? 255 : value));
        });
    }
}
