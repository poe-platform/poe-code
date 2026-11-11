import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { operators: [], start: 10000 },
        { operators: ["-equalize"], start: 10000 },
        { operators: ["-equalize", "-equalize"], start: 10000 },
        { operators: ["-channel", "RGB", "-equalize"], start: 10000 },
        { operators: ["-channel", "R", "-equalize"], start: 10000 },
        { operators: ["-equalize"], start: 0 }
    ])(`preserves 512 16-bit gradient levels via ${mode}: %j`, async ({ operators, start }) => {
        const samples = Uint16Array.from({ length: 512 * 4 }, (_, i) => i % 4 === 3 ? 65535 : start + Math.floor(i / 4));
        const input = encodeImage({ width: 512, height: 1, format: "png", space: "srgb", channels: 3,
            density: 72, hasAlpha: false, depth: "ushort", data16: samples,
            data: Uint8Array.from(samples, value => Math.round(value / 257)) }, { format: "png" }).data;
        expect(decodeImage(input).data16).toEqual(samples);
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...operators, "PNG48:out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        // ImageMagick 7 Q16: positive ramp starts 128,256,384,512 and ends 65535.
        // A zero sample is subtracted from the cumulative histogram instead.
        // Native HDRI rounds rank 257/512 to float32 before export: 32896, not 32895.
        const expected = Uint16Array.from(samples, (value, i) => i % 4 === 3 || operators.length === 0 || operators.includes("R") && i % 4 !== 0
            ? value : Math.round(Math.fround((Math.floor(i / 4) + (start === 0 ? 0 : 1)) * 65535 / (start === 0 ? 511 : 512))));
        expect(new Set(Array.from(output.data16 ?? []).filter((_, i) => i % 4 === 0)).size).toBe(512);
        expect(output.data16).toEqual(expected);
    });
}
