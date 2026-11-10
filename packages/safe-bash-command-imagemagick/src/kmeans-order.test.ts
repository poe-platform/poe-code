import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

for (const retained of [false, true])
it(`rejects kmeans before the first image without replacing output (retained=${retained})`, async () => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map([["out", keep]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out", keep);
    const result = await runMagickCli(["-seed", "7", "-kmeans", "2", "xc:#202040", "xc:#405080", "xc:#808060", "xc:#b0a040", "+append", "-depth", "8", "rgba:out"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no images found for operation '-kmeans'");
    expect(retained ? await fs.readFile("/out") : files.get("out")).toEqual(keep);
});

it.each([
    [false, [], [32, 32, 64, 255, 64, 80, 128, 255, 128, 128, 96, 255, 176, 160, 64, 255]],
    [false, ["-kmeans", "2x1"], [48, 56, 96, 255, 48, 56, 96, 255, 152, 144, 80, 255, 152, 144, 80, 255]],
    [true, ["-kmeans", "2"], [75, 69, 69, 80]],
])("preserves public command operator order %j", async (before, operator, expected) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", new TextEncoder().encode("KEEP"));
    const args = createCommandArguments(["-seed", "7", ...(before ? operator : []), "xc:#202040", "xc:#405080", "xc:#808060", "xc:#b0a040", "+append", ...(!before ? operator : []), "-depth", "8", "rgba:out"]);
    const result = await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(before ? 1 : 0);
    expect(Array.from(await fs.readFile("/out"))).toEqual(expected);
});

