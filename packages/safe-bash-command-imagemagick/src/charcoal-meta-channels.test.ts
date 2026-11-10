import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI clears charcoal's extra samples,
// retaining the channel layout and allowing subsequent explicit writes.
const input = ["(", "xc:#404040", "xc:#808080", "+append", ")", "-duplicate", "3",
    "(", "xc:#202020", "xc:#c0c0c0", "+append", ")", "-combine"];
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
    { name: "input channels", operations: [], output: ["-format", "%[channels]", "info:/out"], expected: "srgba 5.1", text: true },
    { name: "input Meta0", operations: [], expected: "20c0" },
    { name: "charcoal channels", operations: ["-charcoal", "1x1"], output: ["-format", "%[channels]", "info:/out"], expected: "gray  2.1", text: true },
    { name: "cleared Meta0", operations: ["-charcoal", "1x1"], expected: "0000" },
    { name: "writable Meta0", operations: ["-charcoal", "1x1", "+channel", "-channel", "Meta0", "-evaluate", "Set", "50%"], expected: "8080" },
    { name: "explicit Meta0", operations: ["-channel", "Meta0", "-charcoal", "1x1"], expected: "0000" },
])(`${mode}: $name`, async ({ operations, output, expected, text }) => {
    const argv = [...input, ...operations, "+channel", ...(output ?? ["-channel", "Meta0", "-separate", "+channel", "-depth", "8", "gray:/out"])];
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
