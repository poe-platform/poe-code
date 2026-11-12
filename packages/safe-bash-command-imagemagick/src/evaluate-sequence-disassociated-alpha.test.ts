import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference RGBA8 bytes.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
    { first: false, second: true, operation: "Mean", expected: "974b4488" },
    { first: false, second: true, operation: "Max", expected: "e07660d0" },
    { first: false, second: false, operation: "Mean", expected: "90404088" },
    { first: true, second: false, operation: "Mean", expected: "ff70cfff" },
])(`${mode}: disassociated alpha first=$first second=$second, $operation`, async ({ first, second, operation, expected }) => {
    const argv = ["(", "xc:#e0206040", ...(first ? ["-alpha", "disassociate"] : []), ")",
        "(", "xc:#406020d0", ...(second ? ["-alpha", "disassociate"] : []), ")",
        "-evaluate-sequence", operation, "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
