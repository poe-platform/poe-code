import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, exact raw CMYK stdout bytes.
for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    { name: "no convolution", selection: [], kernel: undefined, expected: "000000ff00000000" },
    { name: "identity", selection: [], kernel: "0,0,0,0,1,0,0,0,0", expected: "000000ff00000000" },
    { name: "default channels", selection: [], kernel: "0,0,0,1,1,1,0,0,0", expected: "000000aa00000055" },
    { name: "explicit default", selection: ["-channel", "Default"], kernel: "0,0,0,1,1,1,0,0,0", expected: "000000aa00000055" },
    { name: "black only", selection: ["-channel", "K"], kernel: "0,0,0,1,1,1,0,0,0", expected: "000000aa00000055" },
    { name: "exclude black", selection: ["-channel", "CMY"], kernel: "0,0,0,1,1,1,0,0,0", expected: "000000ff00000000" },
    { name: "reset channels", selection: ["-channel", "CMY", "+channel"], kernel: "0,0,0,1,1,1,0,0,0", expected: "000000aa00000055" },
])(`convolves CMYK black ink (${mode}, $name)`, async ({ selection, kernel, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = ["xc:black", "xc:white", "+append", "-colorspace", "CMYK", ...selection,
        ...(kernel ? ["-convolve", kernel] : []), "-depth", "8", "cmyk:-"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode, "stderr" in result ? String(result.stderr) : stderr).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? Buffer.from(result.stdoutBytes).toString("hex") : stdout).toBe(expected);
});
