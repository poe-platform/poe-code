import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference samples.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    for (const value of ["80,110,125", "100,100,100"]) {
        it.each([
            [["-channel", "R", "-separate", "-depth", "8", "gray:/out"], "41", "55"],
            [["-channel", "G", "-separate", "-depth", "8", "gray:/out"], "81", "9e"],
            [["-colorspace", "sRGB", "-depth", "8", "rgba:/out"], "21837e80", "34a05c80"],
            [["-format", "%[colorspace]", "info:/out"], "DisplayP3", "DisplayP3"],
        ] as const)(`${mode}: DisplayP3 modulation ${value}, %j`, async (outputArgs, adjusted, neutral) => {
            const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
            const argv = ["xc:#34a05c80", "-colorspace", "DisplayP3", "-modulate", value, ...outputArgs];
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
            expect(outputArgs[0] === "-format" ? new TextDecoder().decode(output) : Buffer.from(output).toString("hex"))
                .toBe(value === "100,100,100" ? neutral : adjusted);
        });
    }
}
