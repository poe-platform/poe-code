import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
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
            // The analysis uses 8-bit samples; native retains fractional 16-bit input.
            expect(Math.abs(actual[i]! - native[i]!)).toBeLessThanOrEqual(1);
            if (channels && (i % 4 === 3 || !channels.includes("RGB"[i % 4]!))) expect(actual[i]).toBe(original[i]);
        }
    });
}
