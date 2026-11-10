import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI dimensions; newly allocated samples are unspecified.
const cases = [
    { name: "extra channel", options: ["-deskew", "40%"], channel: "Meta0", expected: "5x3" },
    { name: "point-filtered extra channel", options: ["-filter", "point", "-deskew", "40%"], channel: "Meta0", expected: "5x3" },
    { name: "auto-cropped extra channel", options: ["-define", "deskew:auto-crop=true", "-deskew", "40%"], channel: "Meta0", expected: "1x1" },
    { name: "auto-cropped red control", options: ["-define", "deskew:auto-crop=true", "-deskew", "40%"], channel: "R", expected: "1x1" },
    { name: "red control", options: ["-deskew", "40%"], channel: "R", expected: "5x3" },
    { name: "unchanged extra channel", options: [], channel: "Meta0", expected: "3x1" }
];

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each(cases)(`keeps $name at the raster dimensions (${mode})`, async ({ options, channel, expected }) => {
        const argv = ["-size", "3x1", "xc:white", "-duplicate", "3", "(", "-size", "1x1",
            "xc:#404040", "xc:#808080", "xc:#c0c0c0", "+append", ")", "-combine", ...options,
            "-channel", channel, "-separate", "+channel", "-format", "%wx%h", "info:"];
        const fs = new MemoryFileSystem();
        let stdout = "", stderr = "";
        const args = createCommandArguments(argv);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
