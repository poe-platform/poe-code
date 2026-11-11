import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { colorspace: "RGB", alpha: false, format: "%[pixel:p{0,0}]", expected: "rgb(0.303527%,0.699541%,1.2983%)" },
        { colorspace: "RGB", alpha: true, format: "%[pixel:p{0,0}]", expected: "rgba(0.303527%,0.699541%,1.2983%,1)" },
        { colorspace: "sRGB", alpha: false, format: "%[pixel:p{0,0}]", expected: "srgb(10,20,30)" },
        { colorspace: "sRGB", alpha: true, format: "%[pixel:p{0,0}]", expected: "srgba(10,20,30,1)" },
        { colorspace: "RGB", alpha: false, format: "%[fx:r] %[fx:g] %[fx:b]", expected: "0.00303527 0.00699541 0.012983" }
    ])(`${mode}: labels $colorspace alpha=$alpha $format`, async ({ colorspace, alpha, format, expected }) => {
        const argv = ["xc:#0a141e", "-colorspace", colorspace, ...(alpha ? ["-alpha", "on"] : []), "-format", format, "info:"];
        const fs = new MemoryFileSystem();
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
