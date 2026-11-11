import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 7x4 raw 8-bit gray rasters.
const antialiased = "ffffffffffffffffffffffffffffff0000000000efffefefefefefff";
const hard = "ffffffffffffffffffffffffffffff0000000000ffffffffffffffff";
for (const mode of ["command", "map"] as const)
for (const switches of [[], ["+antialias"], ["+antialias", "-antialias"]])
it.each([
    "line 1,2 5,2",
    "polyline 1,2 5,2",
    "polyline 1,2 3,2 5,2",
    "polyline 5,2 3,2 1,2",
    "polyline 1,2 1,2 3,2 3,2 5,2",
    "stroke none fill white rectangle 0,0 6,3 fill none stroke black polyline 1,2 5,2",
])(`${mode} ${switches.join(" ")}: native coverage for %s`, async draw => {
    const args = ["-size", "7x4", "xc:white", "-fill", "none", "-stroke", "black", "-strokewidth", "1", ...switches, "-draw", draw, "-depth", "8", "gray:-"];
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
    expect(Buffer.from(bytes).toString("hex")).toBe(switches.at(-1) === "+antialias" ? hard : antialiased);
});
