import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const data16 = Uint16Array.from({ length: 80 }, (_, i) =>
    i % 4 === 3 ? 65535 : 32768 + (17 + Math.floor(i / 4) * [37, 91, 53][i % 4]!) % 128);
const input = encodeImage({
    width: 5, height: 4, data: Uint8Array.from(data16, value => Math.round(value / 257)), data16,
    format: "png", space: "srgb", channels: 3, depth: "ushort", density: 72, hasAlpha: false
}, { format: "png" }).data;

// ImageMagick 7.1.2-35 Q16-HDRI, low-byte RGB16 variations, decoded PNG32 samples.
const cases = [
    { operations: ["-charcoal", "0x1"], gray: [231, 90, 159, 183, 66, 175, 120, 194, 225, 183, 168, 145, 189, 208, 210, 136, 192, 195, 120, 163] },
    { operations: ["-charcoal", "1x0"], gray: [255, 68, 170, 255, 103, 107, 189, 255, 77, 189, 255, 55, 178, 195, 237, 156, 182, 255, 59, 187] },
    { operations: ["-charcoal", "0x0"], gray: [255, 51, 167, 255, 68, 90, 188, 255, 120, 185, 255, 56, 162, 200, 237, 116, 182, 255, 63, 159] },
    { operations: ["-charcoal", "2"], gray: [227, 85, 156, 182, 66, 170, 115, 190, 223, 186, 166, 140, 184, 206, 209, 135, 189, 192, 116, 163] },
    { operations: ["-depth", "8", "-charcoal", "0x1"], gray: Array<number>(20).fill(255) },
    { operations: [], gray: undefined }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(cases)(`${mode}: preserves charcoal input precision for $operations`, async ({ operations, gray }) => {
        const files = new Map([["/input.png", input], ["/out.png", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, data] of files) await fs.writeFile(path, data);
        const argv = ["/input.png", ...operations, `${gray ? "PNG32" : "PNG64"}:/out.png`];
        const argumentValues = createCommandArguments(argv);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(argv, files)
            : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([5, 4]);
        if (gray) expect([...output.data]).toEqual(gray.flatMap(value => [value, value, value, 255]));
        else expect(output.data16).toEqual(data16);
    });
}
