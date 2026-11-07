import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2 Q16-HDRI, 32x24 white PNG, 0x1+10%+30%.
const blackRows = ["11111111111111111111111111111101",
    ...Array<string>(21).fill("10000000000000000000000000000001"),
    "00000000000000000000000000000001", "11111111111111111111111111111111"];
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["black", "white", "reset", "background"])(`honors Canny virtual pixels via ${mode}: %s`, async method => {
        const width = 32, height = 24, data = new Uint8Array(width * height * 4).fill(255);
        const input = encodeImage({ width, height, data, format: "png", density: 72,
            channels: 3, hasAlpha: false, space: "srgb", depth: "uchar" }, { format: "png" }).data;
        const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        const args = ["input.png", "-background", "black", "-virtual-pixel", method === "reset" ? "black" : method,
            ...(method === "reset" ? ["+virtual-pixel"] : []), "-canny", "0x1+10%+30%", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!).data;
        const bits = method === "black" || method === "background" ? blackRows.join("") : "1".repeat(width * height);
        expect([...output]).toEqual([...bits].flatMap(bit => [Number(bit) * 255, Number(bit) * 255, Number(bit) * 255, 255]));
    });
}
