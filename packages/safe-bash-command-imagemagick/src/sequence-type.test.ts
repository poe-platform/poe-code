import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI resets the reduction's image type;
// an active type setting is still applied at output without changing pixels.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-poly", "1,1"], ["-evaluate-sequence", "Mean"]])
it.each([
    { name: "expired type setting", input: ["-respect-parentheses", "(", "-type", "Grayscale", "xc:red", ")"], reduce: true, raw: false, expected: "Palette" },
    { name: "no reduction", input: ["-respect-parentheses", "(", "-type", "Grayscale", "xc:red", ")"], reduce: false, raw: false, expected: "Grayscale" },
    { name: "active type setting", input: ["-type", "Grayscale", "xc:red"], reduce: true, raw: false, expected: "Grayscale" },
    { name: "unchanged pixels", input: ["-respect-parentheses", "(", "-type", "Grayscale", "xc:red", ")"], reduce: true, raw: true, expected: "ff0000ff" },
])(`${mode} ${operation[0]}: $name`, async ({ input, reduce, raw, expected }) => {
    const argv = [...input, ...(reduce ? operation : []), ...(raw ? ["-depth", "8", "rgba:-"] : ["-format", "%[type]", "info:"])];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? Buffer.concat(chunks).toString(raw ? "hex" : "utf8")
        : raw ? Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []).toString("hex")
        : "stdout" in result ? result.stdout : "";
    expect(output).toBe(expected);
});
