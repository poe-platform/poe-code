import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
    it.each([
        { size: "5x1", input: "gradient:black-white", expected: [0, 64, 128, 191, 255] },
        { size: "1x5", input: "gradient:black-white", expected: [0, 64, 128, 191, 255] },
        { size: "2x3", input: "gradient:black-white", expected: [0, 0, 128, 128, 255, 255] },
        { size: "1x1", input: "gradient:black-white", expected: [0] },
        { size: "5x1", input: "radial-gradient:black-white", expected: [255, 128, 0, 128, 255] }
    ])(`generates $size $input (retained=${retained})`, async ({ size, input, expected }) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        expect(await runConvertCli(["-size", size, input, "PNG64:out.png"], retained ? { filesystem, cwd: "/" } : files))
            .toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const image = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect(Array.from(image.data)).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}
