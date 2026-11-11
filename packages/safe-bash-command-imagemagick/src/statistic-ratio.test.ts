import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = Uint8Array.from(Buffer.from("50350a3420330a3235350a0c54fa12225404820012be48", "hex"));

// Complete gray8 output from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    ...["6:2", "3x1", "(6:2)", "6:2+2+1", "6:2%", "6:2!", "%[option:window]"].map(geometry => ({
        method: "Mean", geometry, expected: "2473755f3329495806455d6f",
    })),
    ...["6x2", "6,2", "6/2"].map(geometry => ({
        method: "Mean", geometry, expected: "40414243333b444c2432404e",
    })),
    ...["6.5:2.5", "2.6x1"].map(geometry => ({
        method: "Mean", geometry, expected: "0c30a786223b2c4300096883",
    })),
    ...["3:2", "1x1", "1:2", "0:2", "3:2+1+1"].map(geometry => ({
        method: "Maximum", geometry, expected: "0c54fa12225404820012be48",
    })),
    { method: "Maximum", geometry: "3x2", expected: "54fafafa54fafafa54bebebe" },
];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(cases)(`${mode}: $method ratio window $geometry matches native pixels`, async ({ method, geometry, expected }) => {
    const fs = new MemoryFileSystem(), files = new Map([["/in.pgm", input]]);
    await fs.writeFile("/in.pgm", input);
    const args = ["/in.pgm", "-set", "option:window", "6:2", "-statistic", method, geometry, "-depth", "8", "gray:-"];
    const stdout: number[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(...bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    stderr = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Uint8Array.from(stdout);
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
