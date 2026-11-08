import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

for (const threshold of ["0", "16400"])
it.each(["buffered", "retained", "sync", "mogrify"])(`preserves 16-bit deskew rendering at threshold ${threshold} (%s)`, async mode => {
    const width = 96, height = 48, data16 = new Uint16Array(width * height * 4).fill(0x4020);
    for (let i = 3; i < data16.length; i += 4) data16[i] = 65535;
    for (let x = 8; x <= 80; x++) for (const baseline of [8, 18, 28]) {
        for (let y = Math.ceil(baseline + (x - 8) / 18); y <= Math.floor(baseline + 3 + (x - 8) / 18); y++) {
            const offset = (y * width + x) * 4;
            data16.fill(0x4000, offset, offset + 3);
        }
    }
    const input = encodeImage({ width, height, data16, data: Uint8Array.from(data16, value => Math.round(value / 257)),
        format: "png", density: 72, channels: 3, hasAlpha: false, space: "srgb", depth: "ushort" }, { format: "png" }).data;
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "-deskew", threshold, "png:-"];
    const result = mode === "mogrify" ? await runMogrifyCli(["-deskew", threshold, "/input.png"], files)
        : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const actual = decodeImage(mode === "mogrify" ? files.get("/input.png")! : result.stdoutBytes!);
    expect(actual.data16).toBeDefined();
    if (threshold === "0") {
        expect([actual.width, actual.height]).toEqual([98, 50]);
        expect(Array.from(actual.data16!.subarray((25 * 98 + 50) * 4, (25 * 98 + 50) * 4 + 4))).toEqual([0x4020, 0x4020, 0x4020, 65535]);
        expect(actual.data16).toContain(0x4000);
    }
    const reference = spawnSync("magick", ["-", "-deskew", threshold, "-depth", "16", "png:-"], { input });
    if (!reference.error) {
        expect(reference.status, reference.stderr.toString()).toBe(0);
        const expected = decodeImage(reference.stdout);
        expect([actual.width, actual.height, actual.virtualCanvas]).toEqual([expected.width, expected.height, expected.virtualCanvas]);
        expect(Math.max(...actual.data16!.map((value, i) => Math.abs(value - expected.data16![i]!)))).toBeLessThanOrEqual(1);
    }
});
