import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    // Native ImageMagick Q16 RGBA output for input [40, 100, 180, 64].
    it.each([
        { operator: "Sum", value: "50%", channels: [], expected: [168, 228, 255, 192] },
        { operator: "Sum", value: "-32767.5", channels: [], expected: [0, 0, 53, 0] },
        { operator: "Sum", value: "257", channels: [], expected: [41, 101, 181, 65] },
        { operator: "Sum", value: "-50%", channels: [], expected: [0, 0, 52, 0] },
        { operator: "Sum", value: "0", channels: [], expected: [40, 100, 180, 64] },
        { operator: "Sum", value: "50%", channels: ["-channel", "RGB"], expected: [168, 228, 255, 64] },
        { operator: "Sum", value: "50%", channels: ["-channel", "A"], expected: [40, 100, 180, 192] },
        { operator: "Add", value: "50%", channels: [], expected: [168, 228, 255, 192] },
        { operator: "Mean", value: "50%", channels: [], expected: [84, 114, 154, 96] },
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
