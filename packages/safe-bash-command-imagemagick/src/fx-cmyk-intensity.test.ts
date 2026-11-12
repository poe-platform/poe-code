import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, including unchanged channel and sRGB controls.
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { colorspace: ["-colorspace", "CMYK"], expected: "0.404836|0.404836|0.0828729|0.541436|0" },
        { colorspace: [], expected: "0.42245|0.42245|0.65098|0.32549|0.709804" },
    ])(`${mode}: reads FX intensity from working channels $colorspace`, async ({ colorspace, expected }) => {
        const args = ["xc:#a653b580", ...colorspace, "-format", "%[fx:intensity]|%[fx:p{0,0}.intensity]|%[fx:r]|%[fx:g]|%[fx:b]", "info:"];
        const filesystem = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(),
            stdout: { async write(chunk) { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
            signal: new AbortController().signal, registerCleanup() {},
        }) : mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
