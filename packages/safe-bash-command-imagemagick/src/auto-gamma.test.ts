import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { channels: "R", native: [69, 64, 96, 128, 154, 119, 123, 224, 149, 115, 122, 160] },
        { channels: "RGB", native: [69, 92, 110, 128, 154, 146, 137, 224, 149, 142, 135, 160] },
        { channels: "RGBA", native: [69, 92, 110, 128, 154, 146, 137, 224, 149, 142, 135, 160] },
        { channels: "A", native: [32, 64, 96, 128, 114, 119, 123, 224, 109, 115, 122, 160] },
        { channels: "", native: [40, 74, 107, 138, 125, 129, 134, 227, 119, 126, 132, 168] }
    ])(`matches native auto-gamma channel selection $channels via ${mode}`, async ({ channels, native }) => {
        // ImageMagick 7.1.2: -size 3x1 xc:#20406080 -fill '#808080c0'
        // -draw 'point 1,0' -fill '#e0c0a040' -draw 'point 2,0' -strip png:-
        const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAYAAABLcMj3AAAAIklEQVQI12NUUHBwSEhoaAjab64lPTXh/++sP+7/lQ8wAgByuAqOOvnl1gAAAABJRU5ErkJggg==", "base64");
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", ...(channels ? ["-channel", channels] : []), "-auto-gamma", "+channel", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const actual = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!).data;
        const original = decodeImage(input).data;
        for (let i = 0; i < native.length; i++) {
            // Compare the decoded 8-bit projection with the native reference.
            expect(Math.abs(actual[i]! - native[i]!)).toBeLessThanOrEqual(1);
            if (channels && (i % 4 === 3 || !channels.includes("RGB"[i % 4]!))) expect(actual[i]).toBe(original[i]);
        }
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { name: "gray", input: [10000, 10000, 10000, 10016, 10016, 10016, 10032, 10032, 10032, 10048, 10048, 10048], channels: "", expected: [32739, 32739, 32739, 32758, 32758, 32758, 32777, 32777, 32777, 32796, 32796, 32796] },
        { name: "tone", input: [5001, 17201, 26301, 5021, 17221, 26321, 5041, 17241, 26341, 5081, 17281, 26381], channels: "R", expected: [32706, 17201, 26301, 32741, 17221, 26321, 32776, 17241, 26341, 32846, 17281, 26381] }
    ])(`preserves native 16-bit auto-gamma values for $name via ${mode}`, async ({ input, channels, expected }) => {
        // Expected samples captured from ImageMagick 7.1.2-35 Q16-HDRI.
        const data16 = Uint16Array.from(input.flatMap((value, index) => index % 3 === 2 ? [value, 65535] : [value]));
        const png = encodeImage({ width: 4, height: 1, data16,
            data: Uint8Array.from(data16, value => Math.round(value / 257)),
            format: "png", space: "srgb", channels: 3, depth: "ushort", density: 72, hasAlpha: false
        }, { format: "png" }).data;
        const files = new Map([["input.png", png]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", png);
        const args = ["input.png", ...(channels ? ["-channel", channels] : []), "-auto-gamma", "+channel", "PNG48:out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(Array.from(output.data16 ?? [])).toEqual(expected.flatMap((value, index) => index % 3 === 2 ? [value, 65535] : [value]));
    });
}
