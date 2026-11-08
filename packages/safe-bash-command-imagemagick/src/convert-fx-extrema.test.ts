import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["maxima.r", "RGB", [0, 204, 204, 204, 0, 204, 204, 204]],
        ["minima.r", "RGB", [0, 51, 51, 204, 0, 51, 51, 204]],
        ["median.r", "RGB", [0, 51, 51, 204, 0, 51, 51, 204]],
        ["maxima", "RGB", [0, 204, 204, 204, 0, 204, 204, 204]],
        ["minima", "RGB", [0, 51, 51, 204, 0, 51, 51, 204]],
        ["median", "RGB", [0, 68, 68, 204, 0, 68, 68, 204]],
        ["mean.r", "RGB", [0, 128, 128, 204, 0, 128, 128, 204]],
        ["maxima.r", "B", [51, 102, 0, 204, 204, 153, 0, 204]],
        ["minima", "G", [51, 102, 153, 204, 204, 102, 51, 204]],
        ["maxima", "B", [51, 102, 153, 204, 204, 153, 153, 204]],
    ] as const)(`${mode}: evaluates raster statistic %s with channels %s`, async (expression, channel, expected) => {
        const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from([51, 102, 153, 204, 204, 153, 51, 204]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const sentinel = new TextEncoder().encode("keep");
        const files = new Map([["input.png", input], ["out.png", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        await filesystem.writeFile("/out.png", sentinel);
        const args = ["input.png", "-channel", channel, "-fx", expression, "+channel", "out.png"];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
            signal: new AbortController().signal, registerCleanup() {},
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect(result.exitCode).toBe(0);
        expect(Array.from(decodeImage(output).data)).toEqual(expected);
    });
}
