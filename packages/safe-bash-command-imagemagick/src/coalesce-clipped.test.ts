import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI checks the preceding frame's disposal rows.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const operation of [["-coalesce"], ["-layers", "Coalesce"]])
it.each([
    { page: "1x1+1+0", second: true, error: "no pixels defined in cache", pixels: "" },
    { page: "1x1-1+0", second: true, error: "no pixels defined in cache", pixels: "" },
    { page: "1x1+2+0", second: true, error: "width or height exceeds limit", pixels: "" },
    { page: "1x1-2+0", second: true, error: "width or height exceeds limit", pixels: "" },
    { page: "1x1+1+0", second: false, error: "", pixels: "ffffffff" },
    { page: "1x1-1+0", second: false, error: "", pixels: "ffffffff" },
    { page: "1x1+0+0", second: true, error: "", pixels: "ff0000ff0000ffff" },
    { page: "1x1+0+1", second: true, error: "", pixels: "ffffffff0000ffff" },
    { page: "1x1+1+1", second: true, error: "", pixels: "ffffffff0000ffff" },
    { page: "2x1+1+0", second: true, error: "", pixels: "ffffffffff0000ff0000ffffff0000ff" },
])(`${mode} ${operation.join(" ")} $page second=$second`, async ({ page, second, error, pixels }) => {
    const argv = ["(", "xc:red", "-repage", page, ")", ...(second ? ["xc:blue"] : []), ...operation, "-depth", "8", "rgba:-"];
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
    expect(result.exitCode).toBe(error ? 1 : 0);
    const diagnostic = "stderr" in result ? result.stderr : stderr;
    if (error) expect(diagnostic).toContain(error);
    else expect(diagnostic).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(pixels);
});
