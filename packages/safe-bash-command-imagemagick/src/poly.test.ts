import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// RGB8 samples and expected outputs captured with ImageMagick 7.1.2-35 Q16-HDRI.
const inputs = ["c8f014f014331433c833c8f0", "643c8c3c8cf18cf164f1643c"];
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        ["0.5,1,0.5,1", "969650965092509296929696"],
        ["1,1,0,1", inputs[0]!],
        ["0,1,1,1", inputs[1]!],
        ["1,2,0,1", "9de202e2020a020a9d0a9de2"],
    ])(`${mode}: evaluates polynomial %s`, async (polynomial, expected) => {
        const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
        for (const [index, hex] of inputs.entries()) {
            const rgb = Buffer.from(hex, "hex"), data = new Uint8Array(16);
            for (let pixel = 0; pixel < 4; pixel++) {
                data.set(rgb.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
                data[pixel * 4 + 3] = 255;
            }
            const bytes = encodeImage({ width: 4, height: 1, format: "png", space: "srgb", channels: 3, density: 72, hasAlpha: false, depth: "uchar", data }, { format: "png" }).data;
            files.set(`/in${index}.png`, bytes);
            await fs.writeFile(`/in${index}.png`, bytes);
        }
        const args = ["/in0.png", "/in1.png", "-poly", polynomial, "PNG24:/out.png"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async () => {} }, stderr: { write: async () => {} },
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect(result, JSON.stringify(result)).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect([output.width, output.height]).toEqual([4, 1]);
        expect(Buffer.from(output.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(expected);
    });
}
