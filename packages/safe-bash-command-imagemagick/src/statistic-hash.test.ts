import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, raw gray8 in row-major order.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { statistic: "Mean", geometry: "2x1#", expected: "0c30a786223b2c4300096883" },
    { statistic: "Mean", geometry: "2x1", expected: "0c30a786223b2c4300096883" },
    { statistic: "Mean", geometry: "2x2#", expected: "0c30a78617366a6511224a63" },
    { statistic: "Mean", geometry: "2x2", expected: "0c30a78617366a6511224a63" },
    { statistic: "Maximum", geometry: "2x1#", expected: "0c54fafa225454820012bebe" },
    { statistic: "Maximum", geometry: "2x1", expected: "0c54fafa225454820012bebe" },
    { statistic: "Maximum", geometry: "2x2#", expected: "0c54fafa2254fafa2254bebe" },
    { statistic: "Maximum", geometry: "2x2", expected: "0c54fafa2254fafa2254bebe" },
])(`${mode}: preserves the $statistic $geometry window`, async ({ statistic, geometry, expected }) => {
    const input = Buffer.from("50350a3420330a3235350a0c54fa12225404820012be48", "hex");
    const fs = new MemoryFileSystem(), files = new Map([["/in.pgm", input]]);
    await fs.writeFile("/in.pgm", input);
    const args = ["/in.pgm", "-statistic", statistic, geometry, "-depth", "8", "gray:-"];
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
