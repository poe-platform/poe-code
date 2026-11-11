import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 4x2 raw 8-bit gray rasters.
for (const mode of ["command", "map"] as const)
it.each([
    { draw: "line 0,0 3,1", switches: ["+antialias"], expected: "000000ffff000000" },
    { draw: "line 3,1 0,0", switches: ["+antialias"], expected: "000000ffff000000" },
    { draw: "line 0,0 3,1", switches: [], expected: "00219ee8e89e2100" },
    { draw: "line 0,0 3,1", switches: ["+antialias", "-antialias"], expected: "00219ee8e89e2100" },
    { draw: "line 0,0 3,0", switches: ["+antialias"], expected: "00000000ffffffff" },
])(`${mode}: native coverage for $draw with $switches`, async ({ draw, switches, expected }) => {
    const args = ["-size", "4x2", "xc:white", "-fill", "none", "-stroke", "black", ...switches, "-draw", draw, "-depth", "8", "gray:-"];
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "map" ? await runConvertCli(args, new Map()) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs: new MemoryFileSystem(),
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async bytes => { stdout.push(bytes); } },
        stderr: { write: async bytes => { stderr.push(bytes); } },
    });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
