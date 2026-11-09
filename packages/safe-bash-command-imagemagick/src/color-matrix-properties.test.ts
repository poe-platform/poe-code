import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        { matrix: "%[matrix]", expected: [62, 200, 21, 128, 51, 15, 99, 255, 0, 0, 0, 200] },
        { matrix: "%[fx:2/2]", expected: [200, 21, 62, 128, 15, 99, 51, 255, 0, 0, 0, 200] },
        { matrix: "%[fx:w/3]", expected: [200, 21, 62, 128, 15, 99, 51, 255, 0, 0, 0, 200] },
    ])(`-color-matrix expands $matrix before parsing, retained=${retained}`, async ({ matrix, expected }) => {
        const bytes = await sharp(new Uint8Array([200, 21, 62, 128, 15, 99, 51, 255, 0, 0, 0, 200]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/in.png", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/in.png", bytes);
        const result = await runMagickCli(["/in.png", "-set", "option:matrix", "0,0,1 1,0,0 0,1,0", "-color-matrix", matrix, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = retained ? await fs.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
