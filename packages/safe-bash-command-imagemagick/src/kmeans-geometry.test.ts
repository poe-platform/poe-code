import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, seed 7, raw RGBA at depth 8.
for (const mode of ["public", "map"])
it.each([
    ...["1,1", "1/1", "1:1", "1.5x1", "1x", "1x1+", "1x1", "1.5"].map(geometry =>
        [geometry, 0, "646458ff646458ff646458ff646458ff"] as const),
    ...["2x1+1%", "2x1", "2x", "2x50+", "4:2"].map(geometry =>
        [geometry, 0, "303860ff303860ff989050ff989050ff"] as const),
    ["2x0.5", 0, "202040ff405080ff808060ffb0a040ff"] as const,
    ...["bad", "2x1+bad", "2x1+Infinity", "1x1junk", "1x1x1", "65537", "2x1001"].map(geometry =>
        [geometry, 1, "4b454550"] as const),
])(`parses native kmeans geometry %j without losing output on failure (mode=${mode})`, async (geometry, exitCode, expected) => {
    const argv = ["-seed", "7", "xc:#202040", "xc:#405080", "xc:#808060", "xc:#b0a040", "+append",
        "-set", "option:n", "2x1", "-kmeans", geometry, "-depth", "8", "rgba:out"];
    const fs = new MemoryFileSystem(), files = new Map([["out", Buffer.from("KEEP")]]);
    await fs.writeFile("/out", Buffer.from("KEEP"));
    const args = createCommandArguments(argv);
    const result = mode === "map" ? await runMagickCli(argv, files) : await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).toBe(exitCode);
    expect(Buffer.from(mode === "map" ? files.get("out")! : await fs.readFile("/out")).toString("hex")).toBe(expected);
});
