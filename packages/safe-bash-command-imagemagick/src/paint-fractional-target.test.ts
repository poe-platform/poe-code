import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: a quarter quantum differs from black.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const amplify of [false, true])
it.each([
    ["-opaque", "0.25", "0", "000000ff"],
    ["+opaque", "0.25", "0", "ff0000ff"],
    ["-transparent", "0.25", "0", "000000ff"],
    ["+transparent", "0.25", "0", "00000000"],
    ["-opaque", "0.25", "0.1", "000000ff"],
    ["-opaque", "0.25", "1", "ff0000ff"],
    ["-opaque", "0", "0", "ff0000ff"],
])(`${mode}: %s matches fractional add %s with fuzz %s (amplify ${amplify})`, async (operator, add, fuzz, expected) => {
    const argv = ["xc:black", "-channel", "R", "-evaluate", "add", add, "+channel",
        "-fuzz", fuzz, "-fill", "red", operator, "black",
        ...(amplify ? ["-channel", "R", "-evaluate", "multiply", "65535", "+channel"] : []),
        "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
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
    // Amplification exposes any fractional red lost while leaving a pixel unpainted.
    if (amplify && add === "0.25" && expected.startsWith("000000")) expected = `400000${expected.slice(6)}`;
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
