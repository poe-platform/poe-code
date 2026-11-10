import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const operation of [["-coalesce"], ["-layers", "coalesce"]])
it.each([
    { name: "default background", input: ["xc:none"], expected: "000000ff" },
    { name: "red background", input: ["-background", "red", "xc:none"], expected: "000000ff" },
    { name: "black background", input: ["-background", "black", "xc:none"], expected: "000000ff" },
    { name: "colored transparent pixel", input: ["xc:#12345600"], expected: "123456ff" },
    { name: "offset on a red canvas", input: ["-background", "red", "xc:#12345600", "-repage", "3x1+1+0"], expected: "ff0000ff123456ffff0000ff" },
    { name: "transparent second frame over opaque first", input: ["xc:blue", "xc:#12345600"], expected: "0000ffff0000ffff" },
])(`${mode} ${operation.join(" ")} preserves hidden RGB: $name`, async ({ input, expected }) => {
    const argv = ["-size", "1x1", ...input, ...operation, "-alpha", "off", "-depth", "8", "rgba:-"];
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
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
