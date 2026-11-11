import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI reference pixels.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const png of [false, true])
it.each([
    { after: [], expected: "c09084ff" },
    { after: ["-alpha", "Extract"], expected: "000000ff" },
    { after: ["-alpha", "Activate"], expected: "c0908400" },
])(`${mode}: poly Off/Deactivate $after, png=${png}`, async ({ after, expected }) => {
    const argv = ["-respect-parentheses", "(", "xc:#80402020", "-alpha", "Off", ")",
        "(", "xc:#2080c0c0", "-alpha", "Deactivate", ")", "-poly", "1,2 0.5,0",
        ...after, "-depth", "8", png ? "PNG32:-" : "rgba:-"];
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
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks) : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : new Uint8Array();
    expect(Buffer.from(png ? decodeImage(bytes).data : bytes).toString("hex")).toBe(expected);
});
