import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference RGBA samples.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["-smush", "+smush"])
it.each([
    { name: "red", first: ["-channel", "R"], expected: "8000000030000000" },
    { name: "green", first: ["-channel", "G"], expected: "0040000000900000" },
    { name: "blue", first: ["-channel", "B"], expected: "0000c00000005000" },
    { name: "alpha", first: ["-channel", "A"], expected: "0000008000000040" },
    { name: "RGB", first: ["-channel", "RGB"], expected: "8040c00030905000" },
    { name: "RGBA", first: ["-channel", "RGBA"], expected: "8040c08030905040" },
    { name: "default", first: ["-channel", "Default"], expected: "8040c08030905040" },
    { name: "reset", first: ["-channel", "R", "+channel"], expected: "8040c08030905040" },
    { name: "second image only", first: [], second: ["-channel", "A"], expected: "8040c08030905040" },
    { name: "different second selection", first: ["-channel", "R"], second: ["-channel", "A"], expected: "8000000030000000" },
    { name: "overlapping red", first: ["-channel", "R"], gap: "-1", expected: "30000000" },
    { name: "overlapping alpha", first: ["-channel", "A"], gap: "-1", expected: "000000a0" },
    { name: "overlapping reset", first: ["-channel", "R", "+channel"], gap: "-1", expected: "606093a0" },
    { name: "16-bit red", first: ["-channel", "R"], depth: "16", expected: "12340000000000003210000000000000" },
    { name: "16-bit alpha", first: ["-channel", "A"], depth: "16", expected: "00000000000080000000000000004000" },
])(`${mode} ${direction}: $name`, async ({ first, second = [], gap = "0", depth = "8", expected }) => {
    const argv = ["(", depth === "16" ? "xc:#123456789abc8000" : "xc:#8040c080", ...first, ")",
        "(", depth === "16" ? "xc:#32107654ba984000" : "xc:#30905040", ...second, ")",
        "-background", "none", direction, gap, "-depth", depth, "-endian", "MSB", "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
