import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["0,0", [128, 255, 255, 255, 255, 255, 255, 255, 255]],
        ["0,1", [0, 0, 0, 0, 0, 0, 0, 0, 128]],
        ["0,0,1,0.25", [64, 191, 191, 191, 191, 191, 191, 191, 191]],
        ["0,0.5", [0, 0, 0, 0, 0, 255, 255, 255, 255]],
        ["1,0", [128, 128, 148, 170, 248, 255, 255, 255, 255]],
    ] as const)(`${mode}: evaluates ArcSin %s across a grayscale ramp`, async (parameters, expected) => {
        const ramp = [0, 1, 32, 64, 127, 128, 192, 254, 255];
        const input = await sharp(new Uint8Array(ramp.flatMap(value => [value, value, value])), {
            raw: { width: ramp.length, height: 1, channels: 3 },
        }).png().toBuffer();
        const files = new Map([["in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-function", "ArcSin", parameters, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}
