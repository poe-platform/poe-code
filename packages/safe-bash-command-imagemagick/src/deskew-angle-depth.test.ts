import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

it.each(["buffered", "retained", "sync"])("estimates deskew from full 16-bit source values (%s)", async mode => {
    const width = 96, height = 48, data16 = new Uint16Array(width * height * 4).fill(0x4020);
    for (let i = 3; i < data16.length; i += 4) data16[i] = 65535;
    for (let x = 8; x <= 80; x++) for (const baseline of [8, 18, 28]) {
        for (let y = Math.round(baseline + (x - 8) / 18); y <= Math.round(baseline + 3 + (x - 8) / 18); y++) {
            const offset = (y * width + x) * 4;
            data16.fill(0x4000, offset, offset + 3);
        }
    }
    const input = encodeImage({ width, height, data16, data: Uint8Array.from(data16, value => Math.round(value / 257)),
        format: "png", density: 72, channels: 3, hasAlpha: false, space: "srgb", depth: "ushort" }, { format: "png" }).data;
    expect(decodeImage(input).data16).toEqual(data16);
    for (const threshold of ["16400", `${16400 / 65535 * 100}%`, "0"]) {
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-deskew", threshold, "-format", "%w|%h|%X|%Y|%[deskew:angle]", "info:"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe(threshold === "0" ? "98|50|-1|-1|-0" : "101|56|-1|-7|-3.5763343749973515");
        const reference = spawnSync("magick", ["-", ...args.slice(1)], { input });
        if (!reference.error) {
            expect(reference.status, reference.stderr.toString()).toBe(0);
            expect(result.stdout.trim()).toBe(reference.stdout.toString());
        }
    }
});

it.each([513, 1031])("reads wide HDRI deskew inputs in bounded spans (%i pixels)", async width => {
    const args = ["-size", `${width}x3`, "gradient:white-black", "-deskew", "40%", "-format", "%w|%h|%[deskew:angle]", "info:"];
    const expected = await runConvertCli(args, new Map());
    expect(expected.exitCode).toBe(0);
    expect(await runConvertCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" })).toEqual(expected);
});
