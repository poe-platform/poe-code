import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const [method, threshold, mask] of [
        ["Otsu", "21.1765%", [255, 255, 0]],
        ["Triangle", "7.45098%", [255, 255, 0]],
        ["Kapur", "0%", [255, 255, 255]],
    ] as const) {
        for (const output of ["null:", "info:"]) it.each(["true", "yes", "1", "false", "0", undefined])(`${mode}: ${method} verbose=%s to ${output} preserves the mask and property`, async verbose => {
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argv = ["xc:red", "xc:green", "xc:blue", "+append",
                ...(verbose === undefined ? [] : ["-define", `auto-threshold:verbose=${verbose}`]),
                "-auto-threshold", method, "-depth", "8", "-write", "gray:/mask",
                "-format", "mask=%[auto-threshold:threshold]", output];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? { ...await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }), stdout, stderr } : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result).toMatchObject({
                exitCode: 0, stderr: "",
                stdout: `${["true", "yes", "1"].includes(verbose ?? "") ? threshold + "\n" : ""}${output === "info:" ? "mask=" + threshold : ""}`,
            });
            expect([...(mode === "command" || mode === "retained" ? await fs.readFile("/mask") : files.get("/mask")!)]).toEqual(mask);
        });
    }
}
