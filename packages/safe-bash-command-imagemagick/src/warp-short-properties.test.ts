import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI dimensions and complete RGB8 output.
const cases = [
    { option: "-wave", operand: "%wx4", expected: "3x7;3x7;" },
    { option: "-wave", operand: "%hx4", expected: "3x3;3x3;" },
    { option: "-wave", operand: "%nx4", expected: "3x5;3x5;" },
    { option: "-wave", operand: "%sx4", expected: "3x1;3x1;" },
    { option: "-wave", operand: "%[fx:w]x4", expected: "3x7;3x7;" },
    { option: "-wave", operand: "3x4", expected: "3x7;3x7;" },
    { option: "-swirl", operand: "%w", expected: "ff00000080000000ffff00000080000000ff" },
    { option: "-implode", operand: "%w", expected: "ff00000080000000ffff00000080000000ff" },
    { option: "-spread", operand: "%w", expected: "ff0000ff0000008000" },
];

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each(cases)(`${mode}: expands $option $operand`, async ({ option, operand, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const dimensions = option === "-wave";
    const args = ["xc:red", "xc:green", "xc:blue", "+append",
        ...(option === "-spread" ? ["-seed", "2", "-virtual-pixel", "tile", "-interpolate", "nearest"] : ["-duplicate", "1"]),
        "-background", "black", option, operand,
        ...(dimensions ? ["-format", "%wx%h;", "info:"] : ["-depth", "8", "rgb:/output"])];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = dimensions ? ("stdout" in result ? result.stdout : stdout)
        : Buffer.from(mode === "retained" || mode === "command" ? await fs.readFile("/output") : files.get("/output")!).toString("hex");
    expect(output).toBe(expected);
});
