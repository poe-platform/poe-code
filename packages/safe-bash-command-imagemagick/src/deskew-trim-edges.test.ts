import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.concat([Buffer.from("P5\n32 24\n255\n"), Buffer.from(Array.from({ length: 32 * 24 }, (_, i) => {
    const x = i % 32, y = Math.floor(i / 32);
    return x >= 3 && x < 29 && (y - (x >> 3) + 24) % 8 < 2 ? 20 : 235;
}))]);

// ImageMagick 7.1.2-35 Q16-HDRI reference dimensions, page geometry and RGB8 hashes.
for (const [edges, width, height, x, hash] of [
    [true, 35, 22, 0, "9555578e191688ab67c9769cd96a7a03eedcd67c9b480032940280591369205b"],
    [false, 28, 20, 4, "a09ac8661e85f94e658443b9876d456872b7bff9032c23e26ee4775ea03605b1"],
] as const) {
    it.each(["buffered", "retained", "sync"])(`honors deskew auto-crop trim edges=${edges} (%s)`, async mode => {
        const files = new Map([["/tilt.pgm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/tilt.pgm", input);
        const args = ["/tilt.pgm", "-define", "deskew:auto-crop=1",
            ...(edges ? ["-define", "trim:edges=north"] : []), "-deskew", "40%", "miff:-"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(result.stdoutBytes!);
        expect([output.width, output.height, output.virtualCanvas]).toEqual([width, height, { width: 36, height: 29, x, y: 3 }]);
        const rgb = output.data.filter((_, index) => index % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(hash);
    });
}
