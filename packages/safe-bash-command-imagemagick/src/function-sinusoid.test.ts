import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-31 Q16-HDRI: input.png -function Sinusoid PARAMS -depth 8 RGBA:-.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["1", 128, [234, 207, 5]],
        ["1,0,0.5,0.5", 128, [234, 207, 5]],
        ["2", 128, [245, 3, 195]],
        ["-1", 128, [21, 48, 250]],
        ["0.5", 128, [188, 248, 229]],
        ["1,180", 128, [21, 48, 250]],
        ["1,360", 128, [234, 207, 5]],
        ["2,90", 255, [78, 155, 19]],
        ["1,0,0.25,0.5", 128, [181, 167, 66]],
        ["1,0,-0.5,0.5", 128, [21, 48, 250]],
        ["1,0,2,0.25", 64, [255, 255, 0]],
        ["1,90,1e40,0.5", 255, [255, 0, 0]],
    ] as const)(`matches native Sinusoid %s endpoints and midrange via ${mode}`, async (params, endpoint, midrange) => {
        const input = await sharp(Uint8Array.from([
            255, 255, 255, 255, 0, 0, 0, 255, 40, 100, 180, 255
        ]), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-channel", "RGB", "-function", "Sinusoid", params, "/out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual([
            endpoint, endpoint, endpoint, 255, endpoint, endpoint, endpoint, 255, ...midrange, 255
        ]);
    });
}
