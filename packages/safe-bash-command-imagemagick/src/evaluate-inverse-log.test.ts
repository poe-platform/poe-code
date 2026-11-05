import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    // Native ImageMagick Q16 RGBA output for input [40, 100, 180, 64].
    it.each([
        { operator: "InverseLog", value: "2", channels: [], expected: [50, 65, 92, 56] },
        { operator: "InverseLog", value: "0", channels: [], expected: [255, 255, 255, 255] },
        { operator: "InverseLog", value: "1", channels: [], expected: [142, 167, 208, 152] },
        { operator: "InverseLog", value: "10", channels: [], expected: [3, 6, 13, 4] },
        { operator: "InverseLog", value: "-2", channels: [], expected: [0, 0, 0, 0] },
        { operator: "InverseLog", value: "0.01%", channels: [], expected: [7, 11, 21, 9] },
        { operator: "InverseLog", value: "2", channels: ["-channel", "RGB"], expected: [50, 65, 92, 64] },
        { operator: "InverseLog", value: "2", channels: ["-channel", "A"], expected: [40, 100, 180, 56] },
        { operator: "Log", value: "2", channels: [], expected: [63, 134, 204, 94] },
    ])(`matches native $operator $value $channels via ${mode}`, async ({ operator, value, channels, expected }) => {
        const input = await sharp(Uint8Array.from([40, 100, 180, 64]), {
            raw: { width: 1, height: 1, channels: 4 }
        }).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", ...channels, "-evaluate", operator, value, "/out.png"];
        const result = mode === "sync"
            ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected);
    });
}
