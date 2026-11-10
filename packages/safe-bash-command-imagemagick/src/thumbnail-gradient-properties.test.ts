import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 uses the first gradient color as the thumbnail source URI.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { input: "gradient:red-blue", repeat: false },
        { input: "gradient:red-blue", repeat: true },
        { input: "radial-gradient:red-blue", repeat: false },
        { input: "radial-gradient:red-blue", repeat: true },
    ])(`${mode} preserves original thumbnail properties for $input (repeat: $repeat)`, async ({ input, repeat }) => {
        const argv = ["-size", "5x3", input, "-thumbnail", "2x2", ...(repeat ? ["-thumbnail", "1x1"] : []),
            "-format", "%wx%h:%[Thumb::Image::Width]:%[Thumb::Image::Height]:%[Thumb::Document::Pages]:%[Thumb::URI]", "info:-"];
        const filesystem = new MemoryFileSystem();
        let stdout = "", stderr = "";
        if (mode === "command") {
            const argumentValues = createCommandArguments(argv);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            });
            expect(result.exitCode, stderr).toBe(0);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
            expect(result.exitCode, result.stderr).toBe(0);
            stdout = result.stdout;
            stderr = result.stderr;
        }
        expect(stdout).toBe(`${repeat ? "1x1" : "2x1"}:5:3:1:./red`);
        expect(stderr).toBe("");
    });
}
