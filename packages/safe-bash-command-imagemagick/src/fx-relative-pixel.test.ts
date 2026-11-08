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
        ["p[1,0]", [1, 2, 2, 4, 5, 5]],
        ["p[-1,0]", [0, 0, 1, 3, 3, 4]],
        ["p[0,1]", [3, 4, 5, 3, 4, 5]],
        ["p[0,-1]", [0, 1, 2, 0, 1, 2]],
        ["p{1,0}", [1, 1, 1, 1, 1, 1]],
        ["u.p[1,0].g", [1, 2, 2, 4, 5, 5]],
        ["u.p{1,0}.g", [1, 1, 1, 1, 1, 1]],
        ["v.p[-1,0]", [5, 5, 4, 2, 2, 1]],
        ["u[1].p[-1,0]", [5, 5, 4, 2, 2, 1]],
        ["p[1-i,-j]", [1, 1, 1, 1, 1, 1]],
    ] as const)(`${mode}: samples %s`, async (expression, indices) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        for (const [name, data] of [["input.png", pixels], ["second.png", [...pixels].reverse()]] as const) {
            const input = encodeImage({ width: 3, height: 2, data: Uint8Array.from(data.flat()), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
            files.set(name, input);
            await filesystem.writeFile(`/${name}`, input);
        }
        const args = ["input.png", "second.png", "-channel", "RGB", "-fx", expression, "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
            signal: new AbortController().signal, registerCleanup() {},
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect(Array.from(decodeImage(output).data)).toEqual(indices.flatMap(index => {
            const pixel = pixels[index]!;
            return expression.endsWith(".g") ? [pixel[1], pixel[1], pixel[1], 255] : pixel;
        }));
    });
}
