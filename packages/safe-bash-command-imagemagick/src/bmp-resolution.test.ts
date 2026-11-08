import { expect, it } from "vitest";
import { encodeImage, type RgbaImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
    for (const tagged of [false, true]) {
        it(`preserves BMP resolution (${mode}, tagged=${tagged})`, async () => {
            const image: RgbaImage = {
                width: 3, height: 1, format: "png", channels: 3, depth: "uchar", space: "srgb", density: 72, hasAlpha: false,
                data: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255),
                ...(tagged ? { resolution: { x: 5906, y: 11811, unit: "meter" as const } } : {})
            };
            const input = encodeImage(image, { format: "png" }).data;
            const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", input);
            const args = ["/in.png", "/out.bmp"];
            const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const bytes = mode === "retained" ? await filesystem.readFile("/out.bmp") : files.get("/out.bmp")!;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            expect([view.getInt32(38, true), view.getInt32(42, true)]).toEqual(tagged ? [5906, 11811] : [0, 0]);
            const start = view.getUint32(10, true);
            expect(Array.from(bytes.subarray(start, start + 9))).toEqual([0, 0, 255, 0, 255, 0, 255, 0, 0]);
        });
    }
}
