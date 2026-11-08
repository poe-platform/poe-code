import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const operator of ["-level", "+level"] as const) {
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it.each(["80%,20%", "52428,13107"])(`preserves descending endpoints for ${operator} %s via ${mode}`, async (endpoints) => {
            const input = await sharp(Uint8Array.from([100, 150, 200]), {
                raw: { width: 1, height: 1, channels: 3 }
            }).png().toBuffer();
            const files = new Map([["/input.png", input]]);
            const filesystem = new MemoryFileSystem();
            if (mode === "retained") await filesystem.writeFile("/input.png", input);
            const command = ["/input.png", operator, endpoints, "/out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(command, files)
                : await runConvertCli(command, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            // Native ImageMagick Q16 reference pixels for both endpoint spellings.
            expect([...decodeImage(output).data]).toEqual(operator === "-level"
                ? [0xad, 0x5a, 0x07, 255]
                : [0x90, 0x72, 0x54, 255]);
        });
    }
}
