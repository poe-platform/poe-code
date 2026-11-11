import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: first-frame alpha traits affect later overlays.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-coalesce"], ["-layers", "Coalesce"]])
for (const output of ["rgba:-", "PNG32:-"])
it.each([
    { alpha: "Discrete", expected: "5500aaff" },
    { alpha: "Deactivate", expected: "0000ffff" },
    { alpha: "Associate", expected: "0000ffff" },
    { alpha: "Off", expected: "7f0080ff" },
    { alpha: undefined, expected: "5500aac0" },
])(`${mode} ${operation.join(" ")} ${output}: $alpha first frame`, async ({ alpha, expected }) => {
    const argv = ["-respect-parentheses", "(", "xc:#ff000080", ...(alpha ? ["-alpha", alpha] : []), ")",
        "(", "xc:#0000ff80", ")", ...operation, "-delete", "0", "-depth", "8", output];
    const fs = new MemoryFileSystem(), chunks: Uint8Array[] = [];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks)
        : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(output === "PNG32:-" ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
});
