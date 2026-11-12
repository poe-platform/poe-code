import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: inactive alpha stays extractable without enabling transparency.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    { alpha: "Discrete", background: "#20402040", extract: false, hex: "204020ff4080c0ff204020ff" },
    { alpha: "Deactivate", background: "none", extract: false, hex: "000000ff4080c0ff000000ff" },
    { alpha: "Discrete", background: "#20402040", extract: true, hex: "408040" },
    { alpha: "Deactivate", background: "#20402040", extract: true, hex: "408040" },
    { alpha: "On", background: "#20402040", extract: false, hex: "204020404080c08020402040" },
])(`${mode}: wave preserves $alpha alpha with background=$background and extract=$extract`, async ({ alpha, background, extract, hex }) => {
    const fs = new MemoryFileSystem();
    const argv = ["xc:#4080c080", "-alpha", alpha, "-background", background, "-interpolate", "Nearest", "-wave", "1x4",
        ...(extract ? ["-alpha", "extract"] : []), "-depth", "8", extract ? "gray:-" : "rgba:-"];
    const args = createCommandArguments(argv), stdout: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(hex);
});
