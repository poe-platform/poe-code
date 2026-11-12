import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["map", "filesystem", "command"])
for (const [options, row] of [
    [[], "ff000000ff000000ffff000000ff000000ff"],
    [["-tile-offset", "+1+0"], "00ff000000ffff000000ff000000ffff0000"],
    [["-tile-offset", "-1+0"], "0000ffff000000ff000000ffff000000ff00"],
    [["-tile-offset", "+1+0", "+tile-offset"], "ff000000ff000000ffff000000ff000000ff"],
] as const)
it(`draws the native RGB tile raster: ${mode}, ${options.join(" ") || "unshifted"}`, async () => {
    const args = ["xc:red", "xc:lime", "xc:blue", "+append", "-write", "tile.miff", "+delete",
        "-size", "6x3", "xc:white", ...options, "-tile", "tile.miff", "-draw", "rectangle 0,0 5,2", "-depth", "8", "rgb:-"];
    const filesystem = new MemoryFileSystem();
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const argumentValues = createCommandArguments(args);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }, registerCleanup() {}, fs: filesystem,
    } as unknown as CommandContext;
    const result = mode === "command" ? await createMagickCommand().execute(context)
        : await runConvertCli(args, mode === "filesystem" ? { filesystem, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes) : Buffer.concat(stdout);
    expect(output.toString("hex")).toBe(row.repeat(3));
    expect(mode === "command" ? Buffer.concat(stderr).toString() : "stderr" in result ? result.stderr : "").toBe("");
});
