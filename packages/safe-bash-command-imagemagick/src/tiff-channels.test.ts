import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { name: "RGB", space: "srgb", channels: 3, hasAlpha: false, pixels: [254, 1, 2, 255, 3, 200, 17, 255] },
        { name: "RGBA", space: "srgb", channels: 4, hasAlpha: true, pixels: [254, 1, 2, 255, 3, 200, 17, 113] },
        { name: "gray", space: "b-w", channels: 1, hasAlpha: false, pixels: [41, 41, 41, 255, 162, 162, 162, 255] },
    ] as const)(`preserves $name PNG bands and pixels in ${mode} TIFF output`, async ({ space, channels, hasAlpha, pixels }) => {
        const { data } = encodeImage({ width: 2, height: 1, format: "png", space, channels, hasAlpha, depth: "uchar", density: 72, data: new Uint8Array(pixels) }, { format: "png" });
        const files = new Map([["in.png", data]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", data);
        const args = ["in.png", "out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "retained" ? await filesystem.readFile("/out.tif") : files.get("out.tif")!;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const directory = view.getUint32(4, true), tags = new Map<number, number>();
        for (let i = 0; i < view.getUint16(directory, true); i++) {
            const entry = directory + 2 + i * 12;
            tags.set(view.getUint16(entry, true), view.getUint16(entry + 8, true));
        }
        expect(tags.get(277)).toBe(channels);
        expect(tags.get(338)).toBe(hasAlpha ? 2 : undefined);
        expect([...decodeImage(bytes).data]).toEqual(pixels);
    });
}
