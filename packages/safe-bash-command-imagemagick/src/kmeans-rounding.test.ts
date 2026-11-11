import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI, seed 42, raw RGBA in MSB order.
for (const mode of ["command", "buffered", "sync"] as const)
it.each([
    { colors: ["#119955", "#18256f"], cluster: true, depth: "8", expected: "155f62ff155f62ff" },
    { colors: ["#119955", "#18256f"], cluster: true, depth: "16", expected: "14955f5f6262ffff14955f5f6262ffff" },
    { colors: ["black", "#010203"], cluster: true, depth: "16", expected: "008101010182ffff008101010182ffff" },
    { colors: ["#119955", "#18256f"], cluster: false, depth: "8", expected: "119955ff18256fff" },
])(`${mode}: rounds native kmeans palette samples ($colors, cluster=$cluster, depth=$depth)`, async ({ colors, cluster, depth, expected }) => {
    const argv = ["-seed", "42", ...colors.map(color => `xc:${color}`), "+append",
        ...(cluster ? ["-kmeans", "1"] : []), "-depth", depth, "-endian", "MSB"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const args = createCommandArguments([...argv, "rgba:-"]);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync([...argv, "rgba:out"], files)
        : await runMagickCli([...argv, "rgba:out"], files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect((mode === "command" ? Buffer.concat(chunks) : Buffer.from(files.get("out")!)).toString("hex")).toBe(expected);
});
