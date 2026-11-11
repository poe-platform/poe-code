import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, MIFF output decoded to RGB8.
const cases = [
    { name: "auto-crop on a positive page", options: ["-define", "deskew:auto-crop=true", "-set", "page", "100x80+7+9"],
        width: 28, height: 25, page: { width: 113, height: 97, x: 7, y: 4 }, hash: "672810e80af4ac395ff999e244f0499b72c70e0594cc09b8973742c03c055f47" },
    { name: "auto-crop without a page", options: ["-define", "deskew:auto-crop=true"],
        width: 34, height: 24, page: { width: 36, height: 29, x: 1, y: 1 }, hash: "aabc9a0c004d925721f86d66ca4fd994564f0d2236941834f22d758508b65946" },
    { name: "positive page without auto-crop", options: ["-set", "page", "100x80+7+9"],
        width: 36, height: 29, page: { width: 113, height: 97, x: 7, y: 4 }, hash: "1701df0375968ac599896d438886d46caf9fb147f67a467898ef4391effb0867" },
    { name: "auto-crop on a negative page", options: ["-define", "deskew:auto-crop=true", "-set", "page", "100x80-7-9"],
        width: 26, height: 17, page: { width: 113, height: 97, x: 1, y: 0 }, hash: "80a077197ce134d7151936926c86a42a2b7789c9907da44c47ce97ad3982e4b4" }
];

for (const mode of ["buffered", "retained", "sync"]) {
    it.each(cases)(`${mode}: matches native deskew $name`, async ({ options, width, height, page, hash }) => {
        const pixels = Uint8Array.from({ length: 32 * 24 }, (_, i) => {
            const x = i % 32, y = Math.floor(i / 32);
            return 3 <= x && x < 29 && (y - (x >> 3) + 24) % 8 < 2 ? 20 : 235;
        });
        const input = new Uint8Array([...new TextEncoder().encode("P5\n32 24\n255\n"), ...pixels]);
        const files = new Map([["/tilt.pgm", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/tilt.pgm", input);
        const args = ["/tilt.pgm", ...options, "-deskew", "40%", "/out.miff"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.miff") : files.get("/out.miff")!;
        const actual = decodeImage(output);
        expect([actual.width, actual.height, actual.virtualCanvas]).toEqual([width, height, page]);
        const rgb = actual.data.filter((_, i) => i % 4 !== 3);
        expect(createHash("sha256").update(rgb).digest("hex")).toBe(hash);
    });
}
