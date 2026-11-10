import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        ["#010203", "RGB", undefined, "0.000303527 0.000607054 0.000910581"],
        ["#4080c0", "RGB", undefined, "0.0512695 0.215861 0.527115"],
        ["#808080", "RGB", undefined, "0.215861 0.215861 0.215861"],
        ["#010203", "sRGB", undefined, "0.00392157 0.00784314 0.0117647"],
        ["#010203", "RGB", "1", [0x14, 0x28, 0x3c, 0xffff]],
        ["#010203", "RGB", "100", [0x7c5, 0xf8a, 0x174f, 0xffff]],
    ] as const)(`${mode}: preserves linear RGB precision for %s %s multiply=%s`, async (color, space, multiply, expected) => {
        const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", files.get("/out")!);
        const args = [`xc:${color}`, "-colorspace", space, ...(multiply === undefined
            ? ["-format", "%[fx:u.r] %[fx:u.g] %[fx:u.b]", "info:/out"]
            : ["-evaluate", "multiply", multiply, "PNG64:/out"])];
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        const output = mode === "sync" || mode === "buffered" ? files.get("/out")! : await fs.readFile("/out");
        expect(typeof expected === "string" ? new TextDecoder().decode(output) : [...decodeImage(output).data16!]).toEqual(expected);
    });
}
