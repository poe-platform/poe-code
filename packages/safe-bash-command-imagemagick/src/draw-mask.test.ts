import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

const definition = (rectangle: string) => `push defs
push mask "limit"
push graphic-context
fill white
rectangle ${rectangle}
pop graphic-context
pop mask
pop defs`;

// Native ImageMagick 7.1.2-35 Q16-HDRI: complete 6x4, 8-bit RGB rasters.
for (const mode of ["command", "map", "filesystem"] as const)
it.each([
    { name: "selected mask", draw: `${definition("1,1 3,2")} push graphic-context mask "url(#limit)" rectangle 0,0 5,3 pop graphic-context`, hash: "b3e73bc48483276612bd0736293025028c12af76a2e4c12c2db03679fd82a2a9" },
    { name: "moved mask", draw: `${definition("3,1 4,2")} push graphic-context mask "url(#limit)" rectangle 0,0 5,3 pop graphic-context`, hash: "02e3a5ab156ba76821d75abef6666a65028c5852aa5e3b05858a02d82315f0f2" },
    { name: "unselected mask", draw: `${definition("1,1 3,2")} push graphic-context rectangle 0,0 5,3 pop graphic-context`, hash: "834a709ba2534ebe3ee1397fd4f7bd288b2acc1d20a08d6c862dcd99b6f04400" },
    { name: "no definition", draw: "rectangle 0,0 5,3", hash: "834a709ba2534ebe3ee1397fd4f7bd288b2acc1d20a08d6c862dcd99b6f04400" },
    { name: "restored context", draw: `${definition("1,1 3,2")} push graphic-context mask "url(#limit)" rectangle 0,0 5,3 pop graphic-context rectangle 1,1 3,2`, hash: "834a709ba2534ebe3ee1397fd4f7bd288b2acc1d20a08d6c862dcd99b6f04400" },
])(`${mode}: $name`, async ({ draw, hash }) => {
    const args = ["-size", "6x4", "xc:white", "-stroke", "none", "-fill", "black", "-draw", `push graphic-context\n${draw}\npop graphic-context`, "-depth", "8", "rgb:-"];
    const fs = new MemoryFileSystem(), stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async bytes => { stdout.push(bytes); } },
        stderr: { write: async bytes => { stderr.push(bytes); } },
    }) : await runConvertCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
    expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const pixels = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(pixels.length).toBe(72);
    expect(createHash("sha256").update(pixels).digest("hex")).toBe(hash);
});
