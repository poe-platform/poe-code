import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    255, 238, 0, 255, 153, 17, 119, 255, 36, 83, 132, 255
]);
const input = encodeImage({ width: 3, height: 2, data: pixels, format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;

for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([
        ["Saturation", 1], ["Relative", 2], ["Perceptual", 4], ["Absolute", 8],
        ["rElAtIvE", 2], ["Undefined", 4]
    ] as const)(`serializes %s intent in BMP V5 output (${mode})`, async (intent, expected) => {
        const files = new Map([["/in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", "-write", "/default.bmp", "-intent", intent, "-write", "/selected.bmp", "+intent", "-write", "/reset.bmp", "-intent", intent, "/final.bmp"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const [path, value] of [["/default.bmp", 4], ["/selected.bmp", expected], ["/reset.bmp", 4], ["/final.bmp", expected]] as const) {
            const output = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
            expect(view.getUint32(14, true)).toBe(124);
            expect(view.getUint32(122, true)).toBe(value);
            expect(decodeImage(output).data).toEqual(pixels);
        }
    });
}
