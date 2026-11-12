import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference bytes.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { alpha: "off", fill: "black", operator: "-transparent", target: "red", expected: "ff000000" },
    { alpha: "deactivate", fill: "black", operator: "-transparent", target: "#ff000080", expected: "ff0000ff" },
    { alpha: "off", fill: "#0000ff40", operator: "-opaque", target: "red", expected: "0000ff40" },
    { alpha: "deactivate", fill: "#0000ff40", operator: "-opaque", target: "red", expected: "0000ff40" },
    { alpha: "discrete", fill: "#0000ff40", operator: "-opaque", target: "red", expected: "0000ff40" },
    { alpha: "deactivate", fill: "#0000ff40", operator: "+opaque", target: "#ff000080", expected: "0000ff40" },
    { alpha: "deactivate", fill: "#0000ff40", operator: "-opaque", target: "blue", expected: "ff0000ff" },
    { alpha: "deactivate", fill: "black", operator: "+transparent", target: "#ff000080", expected: "ff000000" },
    { alpha: "copy", fill: "#0000ff40", operator: "-opaque", target: "red", expected: "0000ff40" },
    { alpha: "copy", fill: "black", operator: "-transparent", target: "red", expected: "ff000000" },
    { alpha: undefined, fill: "black", operator: "-transparent", target: "red", expected: "ff000080" },
    { alpha: undefined, fill: "black", operator: "-transparent", target: "#ff000080", expected: "ff000000" },
    { alpha: "deactivate", fill: "blue", operator: "-opaque", target: "red", expected: "ff0000ff" },
])(`${mode}: alpha=$alpha fill=$fill $operator $target`, async ({ alpha, fill, operator, target, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:#ff000080", ...(alpha ? ["-alpha", alpha] : []), "-fill", fill, operator, target, "-depth", "8", "rgba:-"];
    const argumentValues = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
