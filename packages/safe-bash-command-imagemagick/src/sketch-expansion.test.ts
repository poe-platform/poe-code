import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, LC_ALL=C, MAGICK_THREAD_LIMIT=1.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const [setup, geometry, expected] of [
    [["-set", "option:shape", "1x1+30"], "%[option:shape]", "4a93ddffffff70ff"],
    [[], "%[fx:1]x1+30", "4a93ddffffff70ff"],
    [[], "1x1+30", "4a93ddffffff70ff"],
    [[], "0x1", "4a95dfffffff77ff"]
] as const)
it(`${mode} expands sketch geometry ${geometry}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["-seed", "42", "xc:#204060", "xc:#b06020", "+append",
        ...setup, "-sketch", geometry, "-depth", "8", "rgba:-"];
    const argumentValues = createCommandArguments(argv);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
