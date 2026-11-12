import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, complete 6x3 raw RGB rasters.
const definition = "push pattern stripes 0,0 2,1 fill red rectangle 0,0 1,0 fill blue point 1,0 pop pattern";
for (const mode of ["command", "map", "filesystem"] as const)
it.each([
    { options: ["-draw", `${definition} fill stripes rectangle 0,0 5,2`], row: "ff00000000ff".repeat(3) },
    { options: ["-draw", `push defs ${definition} pop defs fill stripes rectangle 0,0 5,2`], row: "ff00000000ff".repeat(3) },
    { options: ["-draw", `${definition.replace("blue", "lime")} fill stripes rectangle 0,0 5,2`], row: "ff000000ff00".repeat(3) },
    { options: ["-tile", "tile.miff", "-draw", "rectangle 0,0 5,2"], row: "ff00000000ff".repeat(3) },
    { options: ["-draw", definition], row: "ffffff".repeat(6) },
    { options: ["-draw", "push pattern sparse 0,0 2,1 fill red point 0,0 pop pattern fill sparse rectangle 0,0 5,2"], row: "ff0000ffffff".repeat(3) },
    { options: ["-draw", `${definition} fill stripes push graphic-context fill lime rectangle 0,0 5,2 pop graphic-context rectangle 0,0 5,2`], row: "ff00000000ff".repeat(3) },
    { options: ["-draw", `fill lime ${definition} rectangle 0,0 5,2`], row: "00ff00".repeat(6) },
])(`${mode}: named pattern $options`, async ({ options, row }) => {
    const setup = options[0] === "-tile" ? ["xc:red", "xc:blue", "+append", "-write", "tile.miff", "+delete"] : [];
    const args = [...setup, "-size", "6x3", "xc:white", ...options, "-depth", "8", "rgb:-"];
    const fs = new MemoryFileSystem();
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async bytes => { stdout.push(bytes); } },
        stderr: { write: async bytes => { stderr.push(bytes); } },
    }) : await runConvertCli(args, mode === "map" ? new Map() : { filesystem: fs, cwd: "/" });
    expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(stdout);
    expect(Buffer.from(bytes).toString("hex")).toBe(row.repeat(3));
});

for (const mode of ["map", "filesystem"] as const)
it.each(["0,1", "-2,1", "1e12,1e12", "NaN,1"])(`${mode}: rejects invalid pattern dimensions %s without replacing output`, async dimensions => {
    const original = new TextEncoder().encode("keep");
    const files = new Map([["out.png", original]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/out.png", original);
    const result = await runConvertCli(["-size", "6x3", "xc:white", "-draw", `push pattern stripes 0,0 ${dimensions} fill red point 0,0 pop pattern fill stripes rectangle 0,0 5,2`, "out.png"], mode === "map" ? files : { filesystem, cwd: "/" });
    expect(result.exitCode).toBe(1);
    expect(mode === "map" ? files.get("out.png") : await filesystem.readFile("/out.png")).toEqual(original);
});
