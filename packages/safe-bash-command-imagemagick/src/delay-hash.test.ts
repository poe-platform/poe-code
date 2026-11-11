import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: both frames have 12cs delay and repeat forever.
for (const mode of ["command", "filesystem", "map", "sync"] as const) {
  it.each([
    ["-delay", "12#", "xc:red", "xc:blue"],
    ["xc:red", "xc:blue", "-set", "delay", "12#"],
    ["-delay", "12", "xc:red", "xc:blue"],
    ["xc:red", "xc:blue", "-set", "delay", "12"],
  ].map(args => ({ args })))(`${mode} preserves GIF timing: $args`, async ({ args }) => {
    const argv = [...args, "gif:-"];
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(decodeImage(output, { animated: true }).delay).toEqual([120, 120]);
    const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
    expect(extension).toBeGreaterThan(-1);
    expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, 0, 0, 0]);
  });
}
