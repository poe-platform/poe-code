import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI rejects +strip with status 1 and no output.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { option: "+strip", grouped: false },
        { option: "+strip", grouped: true },
        { option: "-strip", grouped: false }
    ])(`${mode}: matches native $option status and info output (grouped=$grouped)`, async ({ option, grouped }) => {
        const filesystem = new MemoryFileSystem();
        const args = [...(grouped ? ["("] : []), "xc:red", option,
            ...(grouped ? [")"] : []), "-format", "%wx%h", "info:"];
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "buffered" ? new Map() : { filesystem, cwd: "/" });
        expect.soft(result.exitCode).toBe(option === "+strip" ? 1 : 0);
        expect.soft(result.stderr).toBe(option === "+strip"
            ? `magick: option deprecated, unable to execute '+strip' at CLI arg ${grouped ? 3 : 2}\n` : "");
        expect(result.stdout).toBe(option === "+strip" ? "" : "1x1");
    });
}
