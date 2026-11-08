import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        ["u.saturation", [128, 128, 128, 204]],
        ["saturation", [128, 128, 128, 204]],
        ["u.hue", [149, 149, 149, 204]],
        ["u.lightness", [102, 102, 102, 204]],
        ["u", [51, 102, 153, 204]],
    ] as const)(`${mode}: matches native 8-bit FX %s`, async (expression, expected) => {
        const input = encodeImage({ width: 1, height: 1, data: Uint8Array.from([51, 102, 153, 204]), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const sentinel = new TextEncoder().encode("keep");
        const files = new Map([["input.png", input], ["out.png", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", input);
        await filesystem.writeFile("/out.png", sentinel);
        const args = ["input.png", "-channel", "RGB", "-fx", expression, "+channel", "out.png"];
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
