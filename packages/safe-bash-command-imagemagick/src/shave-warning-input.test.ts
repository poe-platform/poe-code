import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([false, true])(`identifies the undersized input when shaving (${mode}, quiet=%s)`, async quiet => {
        const filesystem = new MemoryFileSystem();
        const argv = [...(quiet ? ["-quiet"] : []), "-size", "9x9", "xc:red", "-size", "3x2", "xc:blue",
            "-shave", "2x1", "-format", "%wx%h;", "info:-"];
        const args = createCommandArguments(argv);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argv, new Map())
            : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("5x7;3x2;");
        expect("stderr" in result ? result.stderr : stderr).toBe(quiet ? "" : "magick: geometry does not contain image 'blue'\n");
    });
}
