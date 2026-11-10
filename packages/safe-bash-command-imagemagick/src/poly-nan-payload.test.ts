import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps NaN samples through subsequent arithmetic.
for (const mode of ["sync", "map", "retained", "command"] as const) {
    it.each(["nan,1", "nan(1),1", "nan(abc),1", "nan(),1", "+NaN(_a1),1", "-NAN(0Xff),1", "1,nan(abc)"])(`${mode}: retains NaN payload terms %s`, async terms => {
        const fs = createMemoryFileSystem(), stdout: Uint8Array[] = [];
        let stderr = "";
        const args = ["xc:#802040", "-poly", terms, "-evaluate", "add", "30%", "-depth", "8", "rgba:-"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(args, new Map())
            : await runMagickCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const bytes = mode === "command" ? Buffer.concat(stdout)
            : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
        expect(Buffer.from(bytes).toString("hex")).toBe("000000ff");
    });
}
