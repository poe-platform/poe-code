import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete output from ImageMagick 7.1.2-35 Q16-HDRI, including the red-channel control.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each(["Meta0", "R"])(`${mode}: preserves the virtual page when separating %s`, async channel => {
        const argv = ["-size", "3x2", "xc:black", "-duplicate", "3", "gradient:black-white", "-combine",
            "-repage", "9x8+3+2", "-channel", channel, "-separate", "+channel", "-format", "%wx%h:%g", "info:-"];
        const fs = new MemoryFileSystem();
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe("3x2:9x8+3+2");
    });
}
