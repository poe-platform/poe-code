import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: +despeckle is deprecated; -despeckle outputs 244668ff.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    it.each([
        { option: "+despeckle", grouped: false },
        { option: "+despeckle", grouped: true },
        { option: "-despeckle", grouped: false }
    ])(`${mode}: matches native $option status and output (grouped=$grouped)`, async ({ option, grouped }) => {
        const filesystem = new MemoryFileSystem();
        const files = new Map<string, Uint8Array>();
        const args = [...(grouped ? ["("] : []), "xc:#345678", option,
            ...(grouped ? [")"] : []), "-depth", "8", "rgba:-"];
        const stdout: Uint8Array[] = [];
        let stderr = "";
        let exitCode: number;
        if (mode === "command") {
            const argumentValues = createCommandArguments(args);
            const result = await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout.push(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            exitCode = result.exitCode;
        } else {
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
            exitCode = result.exitCode;
            stderr = result.stderr;
            stdout.push(result.stdoutBytes ?? new TextEncoder().encode(result.stdout));
        }
        expect.soft(exitCode).toBe(option === "+despeckle" ? 1 : 0);
        expect.soft(stderr).toBe(option === "+despeckle"
            ? `magick: option deprecated, unable to execute '+despeckle' at CLI arg ${grouped ? 3 : 2}\n` : "");
        expect(Buffer.concat(stdout).toString("hex")).toBe(option === "+despeckle" ? "" : "244668ff");
    });
}
