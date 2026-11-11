import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: offsets require a geometry separator after a scalar window.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const destination of ["gray:-", "gray:/out.raw"])
it.each([
    { statistic: "Mean", geometry: "2+1+2", expected: undefined },
    { statistic: "Maximum", geometry: "2+0", expected: undefined },
    { statistic: "Mean", geometry: "2-1-2", expected: undefined },
    { statistic: "Mean", geometry: "2e0+1+2", expected: undefined },
    { statistic: "Mean", geometry: "2x+1+2", expected: "0c30a78617366a6511224a63" },
    { statistic: "Mean", geometry: "2x2+1+2", expected: "0c30a78617366a6511224a63" },
    { statistic: "Mean", geometry: "2", expected: "0c30a78617366a6511224a63" },
    { statistic: "Mean", geometry: "2e+0", expected: "0c30a78617366a6511224a63" },
])(`${mode} ${destination}: validates $statistic window $geometry`, async ({ statistic, geometry, expected }) => {
    const input = Uint8Array.from(Buffer.from("50350a3420330a3235350a0c54fa12225404820012be48", "hex"));
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["/in.pgm", input], ["/out.raw", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.pgm", input);
    await fs.writeFile("/out.raw", keep);
    const args = ["/in.pgm", "-statistic", statistic, geometry, "-depth", "8", destination];
    let stdout = new Uint8Array(), stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout = Uint8Array.from([...stdout, ...bytes]); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
    if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout = Uint8Array.from(result.stdoutBytes);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
    if (expected === undefined) {
        expect(result.exitCode).toBe(1);
        expect(stderr).toContain(`invalid argument for option '-statistic': ${geometry}`);
        expect(stdout).toHaveLength(0);
        expect(output).toEqual(keep);
    } else {
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.from(destination === "gray:-" ? stdout : output).toString("hex")).toBe(expected);
    }
});
