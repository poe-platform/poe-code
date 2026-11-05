import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    for (const option of ["-color-matrix", "-recolor"]) {
        it.each([
            { matrix: "0.5", expected: [100, 100, 50, 128] },
            { matrix: "0 1 1 0", expected: [100, 200, 50, 128] },
            { matrix: "1 0 0 1", expected: [200, 100, 50, 128] },
            { matrix: "2 0 0 -1", expected: [255, 0, 50, 128] },
            { matrix: "0 1 0 0 0 1 1 0 0", expected: [100, 50, 200, 128] },
        ])(`${option} $matrix preserves unaffected channels, retained=${retained}`, async ({ matrix, expected }) => {
            const bytes = await sharp(new Uint8Array([200, 100, 50, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
            const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const result = await runMagickCli(["/in.png", option, matrix, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual(expected);
        });
    }
}
