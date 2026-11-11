import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, MIFF output decoded to RGB8.
for (const mode of ["buffered", "retained", "sync"]) {
    it.each([
        { percent: true, width: 17, height: 19, x: 10, y: 4, hash: "2dc5fa993f921359b79baba74e2674e528e0534d4cda2f49e9918f6017df30e2" },
        { percent: false, width: 28, height: 20, x: 4, y: 3, hash: "a09ac8661e85f94e658443b9876d456872b7bff9032c23e26ee4775ea03605b1" },
    ])(`honors deskew auto-crop background percentage=$percent (${mode})`, async ({ percent, width, height, x, y, hash }) => {
        const input = Buffer.concat([Buffer.from("P5\n32 24\n255\n"), Buffer.from(Array.from({ length: 32 * 24 }, (_, i) => {
            const x = i % 32, y = Math.floor(i / 32);
            return x >= 3 && x < 29 && (y - (x >> 3) + 24) % 8 < 2 ? 20 : 235;
        }))]);
        const files = new Map([["tilt.pgm", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/tilt.pgm", input);
        const args = ["tilt.pgm", "-define", "deskew:auto-crop=1", ...(percent ? ["-define", "trim:percent-background=50%"] : []), "-deskew", "40%", "out.miff"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("out.miff")!);
        expect([image.width, image.height, image.virtualCanvas]).toEqual([width, height, { width: 36, height: 29, x, y }]);
        const rgb = image.data.filter((_, index) => index % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(hash);
    });
}
