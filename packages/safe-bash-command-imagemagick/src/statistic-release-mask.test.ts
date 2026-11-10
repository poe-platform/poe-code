import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Raw output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { name: "Mean before negate", options: ["-write-mask", "xc:white", "-statistic", "Mean", "3x1", "-negate", "+region"], format: "rgba", expected: "c797dfc7a8b3bfbf84da9a447f7f7f7f2f2fcfcf8f8f3f3f" },
    { name: "Gradient before negate", options: ["-write-mask", "xc:white", "-statistic", "Gradient", "3x1", "-negate", "+region"], format: "rgba", expected: "cda1d3b3ba7cbfbf4f4f3f3f8f8f7f7f2f2fcfcf8f8f3f3f" },
    { name: "region before alpha extract", options: ["-region", "1x1+1+0", "-statistic", "Mean", "3x1", "-alpha", "extract"], format: "gray", expected: "40408080c0c0" },
    { name: "statistic alone control", options: ["-write-mask", "xc:white", "-statistic", "Mean", "3x1", "+region"], format: "rgba", expected: "38682038574c40407b2565bb80808080d0d030307070c0c0" },
    { name: "explicit release before negate control", options: ["-write-mask", "xc:white", "-statistic", "Mean", "3x1", "+region", "-negate"], format: "rgba", expected: "c797dfc7a8b3bfbf84da9a447f7f7f7f2f2fcfcf8f8f3f3f" },
    { name: "explicit release before alpha extract control", options: ["-region", "1x1+1+0", "-statistic", "Mean", "3x1", "+region", "-alpha", "extract"], format: "gray", expected: "40408080c0c0" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: releases the statistic mask ($name)`, async ({ options, format, expected }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["xc:#8020c040", "xc:#20e05080", "xc:#d03070c0", "+append", ...options, "-depth", "16", "-endian", "MSB", `${format}:-`];
    const args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString("hex"); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout = Buffer.from(result.stdoutBytes).toString("hex");
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
});
