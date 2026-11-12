import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 stdout references.
const cases = [
    { name: "red magnification", operations: ["-channel", "R", "-magnify", "+channel"], expected: "f00000f00000200000200000f00000f00000200000200000" },
    { name: "default magnification", operations: ["-magnify"], expected: "f0c814f0c814204090204090f0c814f0c814204090204090" },
    { name: "red sampling", operations: ["-channel", "R", "-sample", "200%", "+channel"], expected: "f0c814f0c814204090204090f0c814f0c814204090204090" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: $name matches native stdout`, async ({ operations, expected }) => {
    const argv = ["xc:#f0c814", "xc:#204090", "+append", ...operations, "-depth", "8", "rgb:-"];
    const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
