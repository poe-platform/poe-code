import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: detected Palette type is independent of storage class.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: [], expected: "PseudoClass sRGB |1|Palette" },
        { options: ["-raise", "1"], expected: "DirectClass sRGB |5|Palette" },
        { options: ["+raise", "1"], expected: "DirectClass sRGB |5|Palette" },
    ])(`${mode}: reports indexed storage after $options`, async ({ options, expected }) => {
        const args = ["-size", "5x5", "xc:#406496", "-colors", "2", ...options,
            "-format", "%r|%k|%[type]", "info:"];
        const filesystem = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "buffered" ? new Map() : { filesystem, cwd: "/" });
        if ("stdout" in result) stdout = result.stdout;
        if ("stderr" in result) stderr = result.stderr;
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(stdout).toBe(expected);
    });
}
