import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI clears the input region on coalesced frames.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const operation of [["-coalesce"], ["-layers", "coalesce"]])
it.each([
    { name: "second input region", regionFrame: 1, clear: false },
    { name: "first input region", regionFrame: 0, clear: false },
    { name: "explicitly cleared region", regionFrame: 1, clear: true },
    { name: "no input region", regionFrame: -1, clear: false },
])(`${mode} ${operation.join(" ")}: $name`, async ({ regionFrame, clear }) => {
    const region = ["-region", "1x1+1+0"];
    const argv = ["-size", "2x1", "-respect-parentheses",
        "(", "xc:#ff000080", ...(regionFrame === 0 ? region : []), ")",
        "(", "xc:#0000ff80", ...(regionFrame === 1 ? region : []), ")", ...operation,
        "-delete", regionFrame === 0 ? "1" : "0", ...(clear ? ["+region"] : []),
        "-evaluate", "set", "0", "+region", "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>(), chunks: Uint8Array[] = [];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe("0000000000000000");
});
