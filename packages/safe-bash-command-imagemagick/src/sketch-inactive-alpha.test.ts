import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, LC_ALL=C, MAGICK_THREAD_LIMIT=1.
for (const mode of ["command", "buffered", "sync"])
for (const [alpha, activate, expected] of [
    ["active", false, "294b6cff9b7049ff"],
    ["Discrete", false, "bfc8d1ffefe8e2ff"],
    ["Discrete", true, "bfc8d1c8efe8e2c6"],
    ["Deactivate", false, "304559ff78563bff"],
    ["Deactivate", true, "3045598078563b40"],
    ["Off", false, "4a93ddffffff70ff"],
    ["opaque", false, "4a93ddffffff70ff"]
] as const)
it(`${mode} sketches ${alpha} alpha (reactivate=${activate})`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [
        "-seed", "42", alpha === "opaque" ? "xc:#204060" : "xc:#20406080",
        alpha === "opaque" ? "xc:#b06020" : "xc:#b0602040", "+append",
        ...(alpha === "active" || alpha === "opaque" ? [] : ["-alpha", alpha]),
        "-sketch", "1x1+30", ...(activate ? ["-alpha", "Activate"] : []),
        "-depth", "8", "rgba:-"
    ];
    const argumentValues = createCommandArguments(argv);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files) : await runMagickCli(argv, files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
