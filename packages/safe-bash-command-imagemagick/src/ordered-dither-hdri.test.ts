import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: preserve dithered working levels above white.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { name: "working levels", options: ["-ordered-dither", "o4x4,4", "-format", "%[fx:r],%[fx:g],%[fx:b]", "info:"], expected: "1.66667,2,2.33333", binary: false },
        { name: "later exposure reduction", options: ["-ordered-dither", "o4x4,4", "-evaluate", "divide", "3", "-depth", "8", "rgb:-"], expected: "8eaac6", binary: true },
        { name: "integer output saturation", options: ["-ordered-dither", "o4x4,4", "-depth", "8", "rgb:-"], expected: "ffffff", binary: true },
        { name: "undithered control", options: ["-format", "%[fx:r],%[fx:g],%[fx:b]", "info:"], expected: "1.50588,1.75686,2.25882", binary: false },
    ])(`${mode}: preserves over-range ordered dither $name`, async ({ options, expected, binary }) => {
        const argv = ["xc:#607090", "-evaluate", "multiply", "4", ...options];
        const fs = new MemoryFileSystem();
        if (mode === "command") {
            const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { chunks.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect(stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(Buffer.concat(chunks).toString(binary ? "hex" : "utf8")).toBe(expected);
        } else {
            const result = mode === "sync" ? runMagickCliSync(argv, new Map())
                : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            expect(binary ? Buffer.from(result.stdoutBytes!).toString("hex") : result.stdout).toBe(expected);
        }
    });
}
