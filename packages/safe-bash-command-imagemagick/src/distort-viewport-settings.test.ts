import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "option", settings: ["-set", "option:distort:viewport", "2x1+1+1"], expected: "2x1|2x1+1+1" },
        { name: "artifact", settings: ["-set", "artifact:distort:viewport", "2x1+1+1"], expected: "2x1|2x1+1+1" },
        { name: "define", settings: ["-define", "distort:viewport=2x1+1+1"], expected: "2x1|2x1+1+1" },
        { name: "default", settings: [], expected: "3x2|3x2+0+0" },
        { name: "ordinary property", settings: ["-set", "distort:viewport", "2x1+1+1"], expected: "3x2|3x2+0+0" },
        { name: "option replaces define", settings: ["-define", "distort:viewport=1x1+0+0", "-set", "option:distort:viewport", "2x1+1+1"], expected: "2x1|2x1+1+1" },
        { name: "define replaces option", settings: ["-set", "option:distort:viewport", "1x1+0+0", "-define", "distort:viewport=2x1+1+1"], expected: "2x1|2x1+1+1" },
        { name: "artifact overrides option", settings: ["-set", "artifact:distort:viewport", "2x1+1+1", "-set", "option:distort:viewport", "1x1+0+0"], expected: "2x1|2x1+1+1" },
        { name: "removed artifact falls back to option", settings: ["-set", "option:distort:viewport", "2x1+1+1", "-set", "artifact:distort:viewport", "1x1+0+0", "+set", "artifact:distort:viewport"], expected: "2x1|2x1+1+1" },
        { name: "removed option", settings: ["-set", "option:distort:viewport", "2x1+1+1", "+set", "option:distort:viewport"], expected: "3x2|3x2+0+0" },
        { name: "option removed by +define", settings: ["-set", "option:distort:viewport", "2x1+1+1", "+define", "distort:viewport"], expected: "3x2|3x2+0+0" },
        { name: "separate image artifacts", settings: ["-set", "artifact:distort:viewport", "2x1+1+1", "(", "-size", "3x2", "xc:blue", "-set", "artifact:distort:viewport", "1x1+0+0", ")"], expected: "2x1|2x1+1+11x1|1x1+0+0" }
    ])(`resolves the distortion viewport from $name (${mode})`, async ({ settings, expected }) => {
        const args = ["-size", "3x2", "xc:red", ...settings, "-filter", "point", "-distort", "SRT", "0", "-format", "%wx%h|%g", "info:-"];
        const fs = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        let result;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            let stdout = "", stderr = "";
            const status = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
            result = { ...status, stdout, stderr };
        } else {
            result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        }
        expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
