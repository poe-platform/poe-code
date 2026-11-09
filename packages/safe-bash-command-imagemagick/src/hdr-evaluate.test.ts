import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./exr-fixtures.json" with { type: "json" };

const exr = new Uint8Array(Buffer.from(fixtures.alpha, "base64"));
// Two RGBE pixels: [1, 0, 0] and [0, 0, 2].
const hdr = new Uint8Array([...new TextEncoder().encode("#?RGBE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n"), 128, 0, 0, 129, 0, 0, 128, 130]);

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    async function convert(input: Uint8Array, operations: string[], output = "PNG32:/out.png") {
        const files = new Map([["/input", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input", input);
        const args = ["/input", ...operations, output];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
        const path = output.slice(output.indexOf(":") + 1);
        return decodeImage(mode === "retained" || mode === "command" ? await fs.readFile(path) : files.get(path)!);
    }

    // Native ImageMagick Q16-HDRI RGBA8 values for the supplied EXR.
    it.each([
        { operations: [], expected: [0, 32, 255, 128, 0, 128, 255, 255] },
        { operations: ["-evaluate", "Divide", "2"], expected: [0, 16, 191, 128, 0, 64, 128, 255] },
        { operations: ["-evaluate", "Add", "25%"], expected: [0, 96, 255, 128, 64, 191, 255, 255] },
        { operations: ["-clamp", "-evaluate", "Divide", "2"], expected: [0, 16, 128, 128, 0, 64, 128, 255] },
        { operations: ["-clamp", "-evaluate", "Add", "25%"], expected: [64, 96, 255, 128, 64, 191, 255, 255] },
        { operations: ["-evaluate", "Divide", "2", "-evaluate", "Multiply", "2"], expected: [0, 32, 255, 128, 0, 128, 255, 255] },
    ])(`EXR preserves HDR arithmetic (${mode}): $operations`, async ({ operations, expected }) => {
        const image = await convert(exr, ["-channel", "RGB", ...operations, "+channel"]);
        expect(Array.from(image.data)).toEqual(expected);
    });

    it.each([false, true])(`Radiance respects explicit clamping (${mode}, clamp=%s)`, async clamp => {
        const image = await convert(hdr, [...(clamp ? ["-clamp"] : []), "-evaluate", "Divide", "2"]);
        expect(Array.from(image.data)).toEqual([128, 0, 0, 255, 0, 0, clamp ? 128 : 255, 255]);
    });

    it(`evaluates selected EXR channels including alpha (${mode})`, async () => {
        const image = await convert(exr, ["-channel", "BA", "-evaluate", "Divide", "2", "+channel"]);
        expect(Array.from(image.data)).toEqual([0, 32, 191, 64, 0, 128, 128, 128]);
    });

    it(`preserves HDR samples through geometry and storage chunks (${mode})`, async () => {
        const dataFloat = Float32Array.from({ length: 1025 * 2 * 4 }, (_, i) => [-.25, .125, 1.5, .5][i % 4]!);
        const input = encodeImage({ ...decodeImage(exr), width: 1025, height: 2,
            data: new Uint8Array(dataFloat.length), data16: new Uint16Array(dataFloat.length), dataFloat }, { format: "exr" }).data;
        const image = await convert(input, ["-flop", "-channel", "RGB", "-evaluate", "Divide", "2", "-flip", "+channel"]);
        expect(Array.from(image.data)).toEqual(Array.from({ length: 1025 * 2 }, () => [0, 16, 191, 128]).flat());
    });

    it(`writes evaluated EXR samples including alpha (${mode})`, async () => {
        const image = await convert(exr, ["-channel", "RGBA", "-evaluate", "Divide", "2", "+channel"], "/out.exr");
        expect(Array.from(image.dataFloat!)).toEqual([-.125, .0625, .75, .25, 0, .25, .5, .5]);
    });

    it(`writes evaluated Radiance samples (${mode})`, async () => {
        const image = await convert(hdr, ["-evaluate", "Divide", "2"], "/out.hdr");
        // The HDR encoder linearizes sRGB and quantizes the RGBE mantissa.
        expect(Array.from(image.dataFloat!)).toEqual([.2138671875, 0, 0, 1, 0, 0, 1, 1]);
    });

    it(`writes evaluated HDR values instead of original samples (${mode})`, async () => {
        const image = await convert(exr, ["-channel", "RGB", "-evaluate", "Divide", "2", "+channel"], "/out.pfm");
        expect(Array.from(image.dataFloat!)).toEqual([-.125, .0625, .75, 1, 0, .25, .5, 1]);
    });
}
