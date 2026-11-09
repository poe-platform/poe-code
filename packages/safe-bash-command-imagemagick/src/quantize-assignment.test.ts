import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const source = [
    62, 70, 226, 255, 123, 11, 18, 255, 211, 203, 179, 255,
    216, 199, 205, 255, 26, 211, 7, 255, 196, 19, 165, 255,
    243, 39, 186, 255, 236, 37, 211, 255, 152, 252, 43, 255,
    124, 69, 182, 255, 69, 111, 144, 255, 183, 187, 236, 255,
    116, 65, 190, 255, 201, 87, 168, 255, 231, 15, 94, 255,
    37, 212, 193, 255, 216, 78, 94, 255, 19, 2, 165, 255,
    122, 168, 167, 255, 230, 194, 173, 255, 101, 35, 35, 255,
    223, 156, 193, 255, 69, 216, 61, 255, 228, 159, 53, 255,
    18, 239, 77, 255, 96, 47, 26, 255, 17, 34, 163, 255,
    60, 46, 66, 255, 155, 84, 234, 255, 206, 132, 120, 255,
    244, 221, 247, 255, 34, 254, 229, 255, 98, 17, 58, 255,
    237, 192, 37, 255, 160, 63, 220, 255, 1, 18, 92, 255,
];
// Decoded native ImageMagick Q16-HDRI output for +dither -colors.
const expected: Record<number, number[]> = {
    2: [0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 1, 0, 0].flatMap(index =>
        [[68, 59, 178, 255], [152, 126, 130, 255]][index]!),
    4: [0, 1, 2, 2, 2, 3, 3, 3, 2, 0, 0, 2, 0, 3, 3, 2, 3, 0, 2, 2, 1, 2, 2, 2, 2, 1, 0, 1, 3, 2, 2, 2, 1, 2, 3, 1].flatMap(index =>
        [[68, 59, 178, 255], [80, 29, 49, 255], [160, 183, 134, 255], [199, 55, 197, 255]][index]!),
};

for (const colors of [2, 4]) {
    for (const mode of ["public", "sync"]) {
        it(`assigns every opaque pixel to the native ${colors}-color palette (${mode})`, async () => {
            const input = await sharp(new Uint8Array(source), { raw: { width: 36, height: 1, channels: 4 } }).png().toBuffer();
            const args = ["/in.png", "+dither", "-colors", String(colors), "PNG32:/out.png"];
            const files = new Map([["/in.png", input]]);
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            const argumentValues = createCommandArguments(args);
            const result = mode === "public" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
            } as unknown as CommandContext) : runConvertCliSync(args, files);
            expect(result.exitCode).toBe(0);
            const output = mode === "public" ? await fs.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected[colors]);
        });
    }
}
