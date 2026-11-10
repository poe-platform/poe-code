import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// ImageMagick 7.1.2-35: an explicit empty height clears the page height.
for (const mode of ["command", "sync", "buffered", "retained"] as const) {
    it.each([
        ["6x", "3x2|6x0+1+1;", "6x2|6x2+0+0;"],
        ["6x0", "3x2|6x0+1+1;", "6x2|6x2+0+0;"],
        ["6", "3x2|6x3+1+1;", "6x3|6x3+0+0;"],
    ])(`distinguishes empty and omitted page heights for %s via ${mode}`, async (geometry, page, flattened) => {
        for (const flatten of [false, true]) {
            const argv = ["-size", "4x3", "xc:red", "-crop", "3x2+1+1", "-set", "page", geometry,
                ...(flatten ? ["-background", "black", "-flatten"] : []), "-format", "%wx%h|%g;", "info:"];
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(argv);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(argv, files)
                : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
            expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
            expect("stdout" in result ? result.stdout : stdout).toBe(flatten ? flattened : page);
        }
    });
}
