import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: unseeded palettes may use fewer colors than requested.
for (const retained of [false, true])
it.each([
    [7, "3x1", ["#202040", "#405080", "#808060", "#b0a040"], "303860ff303860ff989050ff989050ff"],
    [8, "3x10", ["#202040", "#405080", "#808060", "#b0a040"], "303860ff303860ff989050ff989050ff"],
    [42, "3x300", ["#202040", "#405080", "#808060", "#b0a040"], "303860ff303860ff989050ff989050ff"],
    [7, "2x1", ["#202040", "#405080", "#808060", "#b0a040"], "303860ff303860ff989050ff989050ff"],
    [7, "4x1", ["#202040", "#405080", "#808060", "#b0a040"], "202040ff405080ff808060ffb0a040ff"],
    [7, "3x1", ["red", "lime", "blue"], "ff0000ff00ff00ff0000ffff"],
    [7, "3x1", ["red", "#ef0000", "lime", "blue"], "f70000fff70000ff00ff00ff0000ffff"],
])(`matches native palette grouping with seed %i and %s (retained=${retained})`, async (seed, geometry, colors, expected) => {
    const argv = ["-seed", String(seed), ...colors.map(color => `xc:${color}`), "+append", "-kmeans", geometry, "-depth", "8", "rgba:out"];
    const files = new Map([["out", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", files.get("out")!);
    if (retained) {
        const args = createCommandArguments(argv);
        const result = await createMagickCommand().execute({
            command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} },
        });
        expect(result.exitCode).toBe(0);
    } else {
        const result = await runMagickCli(argv, files);
        expect(result.exitCode, result.stderr).toBe(0);
    }
    expect(Buffer.from(retained ? await fs.readFile("/out") : files.get("out")!).toString("hex")).toBe(expected);
});
