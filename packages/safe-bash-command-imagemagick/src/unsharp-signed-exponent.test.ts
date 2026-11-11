import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, with the same inline two-pixel input.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    ["0x2+1e-1+0", "4d3d5effa38392ff"],
    ["0x1e+0", "372c51ffb9949fff"],
    ["0e-1x2E+0+1E-1+0e+0", "4d3d5effa38392ff"],
    ["0e+0X1E-0+1e+0+5E-2", "372c51ffb9949fff"]
] as const)(`keeps signed exponents within unsharp fields (${mode}): %s`, async (geometry, expected) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:#504060", "xc:#a08090", "+append", "-unsharp", geometry, "-depth", "8", "rgba:/out"];
    const argumentValues = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
