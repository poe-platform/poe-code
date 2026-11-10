import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: charcoal removes the alpha channel.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { operators: ["-alpha", "Activate"], output: ["-depth", "8", "rgba:out"], expected: Uint8Array.of(64, 128, 160, 128) },
        ...[[], ["-alpha", "Discrete"], ["-alpha", "Deactivate"], ["-alpha", "Off"]].flatMap(alpha => [
            { operators: [...alpha, "-charcoal", "1x1"], output: ["-format", "%[channels]", "info:out"], expected: "gray  1.0" },
            { operators: [...alpha, "-charcoal", "1x1"], output: ["-depth", "8", "rgba:out"], expected: Uint8Array.of(255, 255, 255, 255) },
            { operators: [...alpha, "-charcoal", "1x1", "-alpha", "Activate"], output: ["-depth", "8", "rgba:out"], expected: Uint8Array.of(255, 255, 255, 0) }
        ])
    ])(`${mode}: matches charcoal alpha state after $operators with $output`, async ({ operators, output, expected }) => {
        const argv = ["xc:#4080a080", ...operators, ...output];
        const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
        const argumentValues = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(argv, files)
            : mode === "buffered" ? await runMagickCli(argv, files)
            : mode === "retained" ? await runMagickCli(argv, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
        expect(bytes).toEqual(typeof expected === "string" ? new TextEncoder().encode(expected) : expected);
    });
}
