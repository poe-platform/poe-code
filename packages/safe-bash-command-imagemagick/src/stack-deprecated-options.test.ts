import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: deprecated plus forms exit 1 without pixels.
const cases = [
    { options: ["+evaluate-sequence", "Mean"], hex: "" },
    { options: ["+evaluate", "Add", "3"], hex: "" },
    { options: ["+average"], hex: "" },
    { options: ["+poly", "1,1,1,1"], hex: "" },
    { options: ["+clut"], hex: "" },
    { options: ["+hald-clut"], hex: "" },
    { options: ["+coalesce"], hex: "" },
    { options: ["+flatten"], hex: "" },
    { options: ["+mosaic"], hex: "" },
    { options: ["+deconstruct"], hex: "" },
    { options: ["+morph", "1"], hex: "" },
    { options: ["+layers", "merge"], hex: "" },
    { options: ["-evaluate-sequence", "Mean"], hex: "800080" },
    { options: ["+append"], hex: "ff00000000ff" }
];

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
    for (const grouped of [false, true]) {
        it.each(cases)(`${mode}: matches native $options status and pixels (grouped=${grouped})`, async ({ options, hex }) => {
            const fs = new MemoryFileSystem();
            const files = new Map<string, Uint8Array>();
            const argv = [...(grouped ? ["("] : []), "xc:red", "xc:blue", ...options,
                ...(grouped ? [")"] : []), "-depth", "8", "rgb:-"];
            let stdout = "", stderr = "";
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            }) : mode === "sync" ? runMagickCliSync(argv, files)
                : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
            expect.soft(result.exitCode).toBe(hex ? 0 : 1);
            expect.soft("stderr" in result ? result.stderr : stderr).toBe(hex ? ""
                : `magick: option deprecated, unable to execute '${options[0]}' at CLI arg ${grouped ? 4 : 3}\n`);
            expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
                ? Buffer.from(result.stdoutBytes).toString("hex") : "stdout" in result ? result.stdout : stdout)
                .toBe(hex);
        });
    }
}
