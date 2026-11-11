import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([
    Buffer.from("P5\n32 24\n255\n"),
    Buffer.from(Array.from({ length: 32 * 24 }, (_, i) => {
        const x = i % 32, y = Math.floor(i / 32);
        return x >= 3 && x < 29 && (y - (x >> 3) + 24) % 8 < 2 ? 20 : 235;
    })),
]);

for (const options of [
    [],
    ["-define", "deskew:auto-crop=1"],
    ["-set", "option:deskew:auto-crop", "1"],
    ["-set", "option:deskew:auto-crop", "1", "+set", "option:deskew:auto-crop"],
]) {
    it.each(["buffered", "retained", "sync"])(`honors deskew auto-crop ${JSON.stringify(options)} (%s)`, async mode => {
        const files = new Map([["/tilt.pgm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/tilt.pgm", input);
        const args = ["/tilt.pgm", ...options, "-deskew", "40%", "miff:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const image = decodeImage(result.stdoutBytes!);
        const cropped = options.length > 0 && !options.includes("+set");
        // ImageMagick 7.1.2-35 Q16-HDRI, independently decoded as RGB8.
        expect([image.width, image.height, image.virtualCanvas]).toEqual(cropped
            ? [28, 20, { width: 36, height: 29, x: 4, y: 3 }]
            : [36, 29, { width: 36, height: 29, x: -1, y: -4 }]);
        const rgb = image.data.filter((_, i) => i % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(cropped
            ? "a09ac8661e85f94e658443b9876d456872b7bff9032c23e26ee4775ea03605b1"
            : "6c1cf7d74f294df0c37033a23b0d8ad95d5ddbe5f0c17f305c5f07721e6760a9");
    });
}
