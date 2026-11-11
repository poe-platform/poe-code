import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: natural PBM tiles are gray, while
// the GIF checkerboard and explicitly sized canvases have RGB channels.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it.each([
        { input: ["pattern:horizontal"], expected: "1:8x4;" },
        { input: ["pattern:checkerboard"], expected: "3:30x30;3:30x30;3:30x30;" },
        { input: ["-size", "4x3", "pattern:horizontal"], expected: "3:4x3;3:4x3;3:4x3;" },
        { input: ["-size", "4x3", "pattern:horizontal", "-channel", "R"], expected: "1:4x3;" },
    ])(`${mode}: separates native pattern channels for $input`, async ({ input, expected }) => {
        const argv = [...input, "-separate", "-format", "%n:%wx%h;", "info:"];
        const files = new Map<string, Uint8Array>();
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, files)
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
}
