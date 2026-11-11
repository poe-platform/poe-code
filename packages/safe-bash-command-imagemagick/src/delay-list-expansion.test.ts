import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: delays in milliseconds, infinite GIF repetition.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: ["xc:blue", "xc:red", "-delay", "%n", "xc:lime"], delays: [0, 0, 20] },
    { args: ["xc:blue", "xc:red", "-delay", "%[fx:n+6]", "xc:lime"], delays: [0, 0, 80] },
    { args: ["xc:blue", "xc:red", "-delay", "%[fx:u[1].r*10+3]", "xc:lime"], delays: [0, 0, 130] },
    { args: ["xc:blue", "xc:red", "-delay", "13", "xc:lime"], delays: [0, 0, 130] },
    { args: ["-delay", "%n", "xc:red", "xc:blue"], delays: [0, 0] },
    { args: ["-delay", "0", "xc:red", "xc:blue"], delays: [0, 0] },
  ])(`${mode}: expands delay against the current list: $args`, async ({ args, delays }) => {
    const argv = [...args, "gif:-"], fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(argv), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(decodeImage(output, { animated: true }).delay).toEqual(delays);
    const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
    expect(extension).toBeGreaterThan(-1);
    expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, 0, 0, 0]);
  });
}
