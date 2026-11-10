import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const operation of ["Mean", "Median", "Max"])
it.each([
    { name: "separate source selections", prefix: [], grouped: true },
    { name: "restored outer settings", prefix: ["-respect-parentheses"], grouped: true },
    { name: "uniform red selection", prefix: [], grouped: false },
])(`${mode}: ${operation} honors $name`, async ({ prefix, grouped }) => {
    const inputs = grouped
        ? ["(", "xc:#09090990", "-channel", "R", ")", "(", "xc:#33445566", "-channel", "G", ")"]
        : ["xc:#09090990", "xc:#33445566", "-channel", "R"];
    const argv = [...prefix, ...inputs, "-evaluate-sequence", operation, "+channel", "-depth", "8", "rgba:-"];
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
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(grouped
        ? operation === "Mean" ? "05000000" : "09000000"
        : operation === "Mean" ? "1e000000" : "33000000");
});
