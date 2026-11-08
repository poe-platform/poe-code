import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [
    [16, 32, 48, 255], [64, 80, 96, 255], [112, 128, 144, 255],
    [160, 176, 192, 255], [208, 224, 240, 255], [24, 40, 56, 255],
];
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["edge", "p{i-2,j}", [0, 0, 0, 3, 3, 3]],
        ["tile", "p{i-2,j}", [1, 2, 0, 4, 5, 3]],
        ["mirror", "p{i-2,j}", [1, 0, 0, 4, 3, 3]],
        ["background", "p{i-2,j}", [6, 6, 0, 6, 6, 3]],
        ["transparent", "p{i-2,j}", [7, 7, 0, 7, 7, 3]],
        ["black", "p{i-2,j}", [8, 8, 0, 8, 8, 3]],
        ["white", "p{i-2,j}", [9, 9, 0, 9, 9, 3]],
        ["gray", "p{i-2,j}", [10, 10, 0, 10, 10, 3]],
        ["tile", "p{i+3,j+2}", [0, 1, 2, 3, 4, 5]],
        ["mirror", "p{i+3,j+2}", [5, 4, 3, 2, 1, 0]],
        ["edge", "p{i+3,j+2}", [5, 5, 5, 5, 5, 5]],
        ["background", "p{i+3,j+2}", [6, 6, 6, 6, 6, 6]],
        ["tile", "v.p[-2,0]", [4, 3, 5, 1, 0, 2]],
    ] as const)(`${mode}: samples %s virtual pixels for %s`, async (method, expression, indices) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        for (const [name, data] of [["input.png", pixels], ["second.png", [...pixels].reverse()]] as const) {
            const input = encodeImage({ width: 3, height: 2, data: Uint8Array.from(data.flat()), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
            files.set(name, input);
            await filesystem.writeFile(`/${name}`, input);
        }
        const args = ["input.png", "second.png", "-background", "#aabbcc", "-virtual-pixel", method, "-fx", expression, "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
            signal: new AbortController().signal, registerCleanup() {},
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        const expected = [...pixels, [170, 187, 204, 255], [0, 0, 0, 0], [0, 0, 0, 255], [255, 255, 255, 255], [128, 128, 128, 255]];
        expect(Array.from(decodeImage(output).data)).toEqual(indices.flatMap(index => expected[index]!));
    });
}
