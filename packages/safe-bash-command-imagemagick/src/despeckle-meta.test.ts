import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync", "retained"] as const)
it.each([
    ["Meta0", "Meta0", "70"],
    ["Default", "Meta0", "70"],
    ["R", "Meta0", "80"],
    ["R", "R", "40"],
    ["Meta0", "R", "50"],
])(`despeckles selected extra channels: %s, read %s (${mode})`, async (channel, outputChannel, expected) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    const argv = ["xc:#505050", "-duplicate", "3", "xc:#808080", "-combine", "-channel", channel!, "-despeckle", "+channel", "-channel", outputChannel!, "-separate", "+channel", "-depth", "8", "gray:/out"];
    const args = createCommandArguments(argv);
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("/out")!;
    // Native ImageMagick 7.1.2-35 Q16-HDRI, selected extra channels and unselected-channel preservation.
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
