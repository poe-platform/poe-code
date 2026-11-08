import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const operator of ["-level", "+level"] as const) {
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it.each(["20x70%", "20%,70%", "20%x70%", "13107x45874.5", "13107,45874.5"])(`reads both endpoints for ${operator} %s via ${mode}`, async (endpoints) => {
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
                ? [0x62, 0xc6, 0xff, 255]
                : [0x65, 0x7e, 0x97, 255]);
        });
    }
}
