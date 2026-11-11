import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35: plasma thumbnail metadata is independent of random pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const repeat of [false, true]) {
        it.each([
            { input: "plasma:red-blue", uri: "./red" },
            { input: "plasma:fractal", uri: "./fractal" },
            { input: "plasma:", uri: "./white" },
        ])(`${mode} preserves thumbnail source properties for $input (repeat: ${repeat})`, async ({ input, uri }) => {
            const argv = ["-size", "8x6", input, "-thumbnail", "4x3", ...(repeat ? ["-thumbnail", "2x2"] : []),
                "-format", "%wx%h|%[Thumb::Image::Width]|%[Thumb::Image::Height]|%[Thumb::Document::Pages]|%[Thumb::URI]", "info:"];
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
            expect(stdout).toBe(`${repeat ? "2x2" : "4x3"}|8|6|1|${uri}`);
            expect(stderr).toBe("");
        });
    }
}
