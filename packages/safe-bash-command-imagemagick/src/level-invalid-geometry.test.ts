import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const operator of ["-level", "+level"] as const) {
    for (const mode of ["buffered", "retained", "sync"] as const) {
        it.each(["bogus", "20%,80%junk", "0x4000,0xbfff", "20%,80%"])(`${operator} %s preserves or replaces the destination correctly via ${mode}`, async (geometry) => {
            const input = await sharp(Uint8Array.from([100, 150, 200]), {
                raw: { width: 1, height: 1, channels: 3 }
            }).png().toBuffer();
            const original = await sharp(Uint8Array.from([255, 0, 0]), {
                raw: { width: 1, height: 1, channels: 3 }
            }).png().toBuffer();
            const files = new Map([["/input.png", input], ["/out.png", original]]);
            const filesystem = new MemoryFileSystem();
            if (mode === "retained") {
                for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            }
            const args = ["/input.png", operator, geometry, "/out.png"];
            const result = mode === "sync"
                ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            if (geometry === "20%,80%") {
                expect(result.exitCode).toBe(0);
                expect([...decodeImage(output).data]).toEqual(operator === "-level"
                    ? [0x52, 0xa5, 0xf8, 255]
                    : [0x6f, 0x8d, 0xab, 255]);
            } else {
                expect(output).toEqual(original);
                expect(result.exitCode).toBe(1);
                expect(result.stderr).toContain(`invalid argument for option '${operator}'`);
            }
        });
    }
}
