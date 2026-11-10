import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI retains a zero-filled read-mask channel after -poly.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each([
        { placement: "first", grouped: true, clear: false, expected: "0" },
        { placement: "second", grouped: true, clear: false, expected: "0" },
        { placement: "first", grouped: false, clear: false, expected: "0" },
        { placement: "first", grouped: false, clear: true, expected: "0.376471" },
        { placement: "second", grouped: true, clear: true, expected: "0.376471" },
        { placement: "none", grouped: true, clear: false, expected: "0.376471" },
        { placement: "first", grouped: false, clear: false, operation: ["-evaluate-sequence", "mean"], expected: "0" },
        { placement: "second", grouped: true, clear: false, operation: ["-poly", "1,1"], expected: "0" },
    ])(`${mode}: reduces $placement read mask (grouped=$grouped, clear=$clear, $operation)`, async ({ placement, grouped, clear, operation = ["-poly", ".5,1,.5,1"], expected }) => {
        const fs = createMemoryFileSystem();
        let stdout = "", stderr = "";
        const args = ["(", "xc:#802040", ...(placement === "first" ? ["-read-mask", "xc:white"] : []), ")",
            ...(grouped ? ["("] : []), "xc:#40a0e0", ...(placement === "second" ? ["-read-mask", "xc:white"] : []), ...(grouped ? [")"] : []),
            ...operation, ...(clear ? ["+read-mask"] : []), "-format", "%[fx:mean.r]", "info:-"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    });
}
