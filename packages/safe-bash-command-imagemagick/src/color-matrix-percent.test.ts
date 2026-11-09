import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    for (const option of ["-color-matrix", "-recolor"]) {
        it.each([
            { scalar: ".5%", red: [100, 8, 0] },
            { scalar: "50%", red: [255, 255, 0] },
        ])(`${option} reads $scalar as an unscaled scalar, retained=${retained}`, async ({ scalar, red }) => {
            const bytes = await sharp(new Uint8Array([200, 21, 62, 128, 15, 99, 51, 255, 0, 0, 0, 200]), {
                raw: { width: 3, height: 1, channels: 4 }
            }).png().toBuffer();
            const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", bytes);
            const result = await runMagickCli(["/in.png", option, scalar, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual([red[0], 21, 62, 128, red[1], 99, 51, 255, red[2], 0, 0, 200]);
        });
    }
}
