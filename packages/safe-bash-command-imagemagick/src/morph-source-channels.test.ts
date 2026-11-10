import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// First four cases use ImageMagick 7.1.2-35 Q16-HDRI reference pixels.
// Also cover default/reset masks, overrides, successive pairs and extra channels.
const cases = [
    { name: "different grouped channels", inputs: ["(", "xc:#20406080", "-channel", "R", ")", "(", "xc:#a0c0e040", "-channel", "G", ")"], expected: "60c0e040" },
    { name: "restored outer channels", inputs: ["-respect-parentheses", "(", "xc:#20406080", "-channel", "R", ")", "(", "xc:#a0c0e040", "-channel", "G", ")"], expected: "60c0e040" },
    { name: "shared red channel", inputs: ["xc:#20406080", "xc:#a0c0e040", "-channel", "R"], expected: "60c0e040" },
    { name: "default channels", inputs: ["xc:#20406080", "xc:#a0c0e040"], expected: "6080a060" },
    { name: "default first source", inputs: ["xc:#20406080", "(", "xc:#a0c0e040", "-channel", "G", ")"], expected: "6080a060" },
    { name: "reset source channels", inputs: ["(", "xc:#20406080", "-channel", "R", "+channel", ")", "(", "xc:#a0c0e040", "-channel", "G", ")"], expected: "6080a060" },
    { name: "shared override", inputs: ["(", "xc:#20406080", "-channel", "R", ")", "(", "xc:#a0c0e040", "-channel", "G", ")", "-channel", "A"], expected: "a0c0e060" },
    { name: "successive pair masks", inputs: ["(", "xc:#20406080", "-channel", "R", ")", "(", "xc:#a0c0e040", "-channel", "G", ")", "(", "xc:#e0206080", "-channel", "B", ")"], remove: "0,2,4", expected: "60c0e040e0706080" },
    { name: "extra source channel", inputs: ["(", "xc:black", "-duplicate", "3", "xc:#404040", "-combine", "-channel", "Meta0", ")", "(", "xc:black", "-duplicate", "3", "xc:#808080", "-combine", "-channel", "R", ")"], after: ["-channel", "Meta0", "-separate"], expected: "606060ff" },
];

for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each(cases)(`${mode}: morph uses source channels with $name`, async ({ inputs, expected, remove = "0,2", after = [] }) => {
    const argv = [...inputs, "-morph", "1", "-delete", remove, ...after, "+channel", "-depth", "8", "rgba:-"];
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
