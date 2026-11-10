import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// First four cases: ImageMagick 7.1.2-35 Q16-HDRI, including unchanged endpoints.
// Also cover chunk boundaries, Q16 precision and independent generated frames.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
    { count: "1", channel: "Meta0", expected: "406080" },
    { count: "2", channel: "Meta0", expected: "40556b80" },
    { count: "0", channel: "Meta0", expected: "4080" },
    { count: "1", channel: "R", expected: "000000" },
    { count: "2", channel: "Meta0", expected: "40".repeat(4100) + "55".repeat(4100) + "6b".repeat(4100) + "80".repeat(4100), size: "2050x2" },
    { count: "1", channel: "Meta0", expected: "123412351236", colors: ["123412341234", "123612361236"], depth: "16" },
    { count: "2", channel: "Meta0", expected: "406b5580", reverse: true },
])(`${mode}: morph $count frames, separate $channel`, async ({ count, channel, expected, size = "1x1", colors = ["404040", "808080"], depth = "8", reverse = false }) => {
    const argv = [
        "-size", size,
        "(", "xc:black", "-duplicate", "3", `xc:#${colors[0]}`, "-combine", ")",
        "(", "xc:black", "-duplicate", "3", `xc:#${colors[1]}`, "-combine", ")",
        "-morph", count, ...(reverse ? ["-swap", "1,2"] : []),
        "-channel", channel, "-separate", "+channel", "-depth", depth, "-endian", "MSB", "gray:-",
    ];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(mode === "command" ? stderr : "stderr" in result ? result.stderr : "").toBe("");
    expect(result.exitCode).toBe(0);
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
