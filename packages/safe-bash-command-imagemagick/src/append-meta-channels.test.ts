import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI keeps appended meta planes writable,
// but initializes them to zero instead of copying the source samples.
const first = ["(", "xc:#202020", "-duplicate", "3", "xc:#808080", "-combine", ")"];
const second = ["(", "xc:#606060", "-duplicate", "3", "xc:#c0c0c0", "-combine", ")"];
for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const direction of ["+append", "-append"])
it.each([
    { name: "channel count", output: ["-format", "%wx%h/%[channels]", "info:/out"], expected: `${direction === "+append" ? "2x1" : "1x2"}/srgba 5.1`, text: true },
    { name: "zero initial Meta0", output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "0000" },
    { name: "writable Meta0", output: ["-channel", "Meta0", "-evaluate", "Set", "50%", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "8080" },
    { name: "visible RGBA", output: ["-depth", "8", "rgba:/out"], expected: "2020202060606060" },
    { name: "single input Meta0", single: true, output: ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"], expected: "80" },
    { name: "single input channel count", single: true, output: ["-format", "%wx%h/%[channels]", "info:/out"], expected: "1x1/srgba 5.1", text: true },
])(`${mode} ${direction}: $name`, async ({ single, output, expected, text }) => {
    const argv = ["-background", "none", ...first, ...(single ? [] : [...second, direction]), ...output];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(bytes).toString(text ? "utf8" : "hex")).toBe(expected);
});
