import { decodeImage } from "@poe-code/image-ast";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-31 Q16-HDRI reference bytes.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const [operation, groupedHex, alphaHex, unrestrictedHex] of [
    ["Sum", "80000000", "000000e0", "a0c0e0e0"],
    ["Subtract", "80000000", "000000a0", "0040a0a0"],
    ["Multiply", "00000000", "00000018", "10201818"],
    ["Divide", "80000000", "00000000", "00000000"],
    ["Xor", "80000000", "000000e0", "a0c0e0e0"],
    ["Mean", "40000000", "00000070", "50607070"],
])
for (const png of [false, true])
it.each([
    { name: "separate selections", selections: ["R", "B"], expected: groupedHex },
    { name: "alpha selections", selections: ["A", "A"], expected: alphaHex },
    { name: "unrestricted control", selections: [], expected: unrestrictedHex },
    ...(operation === "Multiply" ? [{ name: "retained multiplication precision", selections: ["R", "B"], expected: "80000000", amplify: true }] : []),
])(`${mode}: ${operation} honors $name (png=${png})`, async ({ selections, expected, ...options }) => {
    const inputs = ["#80402020", "#2080c0c0"].flatMap((color, index) =>
        ["(", `xc:${color}`, ...(selections[index] ? ["-channel", selections[index]!] : []), ")"]);
    const argv = ["-respect-parentheses", ...inputs, "-evaluate-sequence", operation!, ...("amplify" in options ? ["-evaluate", "Multiply", "65535"] : []), "-depth", "8", png ? "PNG32:-" : "rgba:-"];
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
    expect(Buffer.from(png ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
});
