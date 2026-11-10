import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference outputs from the reported reproduction.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const direction of ["+smush", "-smush"])
it.each([
    { name: "samples", tail: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "80c0" },
    { name: "gap samples", gap: "1", tail: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "8000c0" },
    { name: "overlapping samples", gap: "-1", tail: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "b5" },
    { name: "editable channel", tail: ["-channel", "Meta0", "-evaluate", "Set", "50%", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "8080" },
    { name: "visible RGBA", tail: ["-depth", "8", "rgba:-"], expected: "2020202060606060" },
    { name: "channel count", tail: ["-format", "%wx%h/%[channels]", "info:"], expected: Buffer.from(`${direction === "+smush" ? "2x1" : "1x2"}/srgba 5.1`).toString("hex") },
    { name: "single input samples", single: true, tail: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:-"], expected: "80" },
    { name: "single input channels", single: true, tail: ["-format", "%wx%h/%[channels]", "info:"], expected: Buffer.from("1x1/srgba 5.1").toString("hex") },
])(`${mode} ${direction}: $name`, async ({ tail, expected, single = false, gap = "0" }) => {
    const argv = [
        "-background", "none",
        "(", "xc:#202020", "-duplicate", "3", "xc:#808080", "-combine", ")",
        ...(single ? [] : ["(", "xc:#606060", "-duplicate", "3", "xc:#c0c0c0", "-combine", ")", direction, gap]),
        ...tail,
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
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : "stdout" in result && typeof result.stdout === "string" ? Buffer.from(result.stdout) : new Uint8Array();
    expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
