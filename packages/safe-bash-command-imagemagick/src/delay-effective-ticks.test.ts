import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 600cs per frame, infinite GIF repetition.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each(["12x0x2", "12x2"].flatMap(value => [
    { args: ["-delay", value, "xc:red", "xc:blue", "gif:-"] },
    { args: ["xc:red", "xc:blue", "-set", "delay", value, "gif:-"] },
  ]))(`${mode} reads the effective tick rate: $args`, async ({ args }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    expect(decodeImage(output, { animated: true }).delay).toEqual([6000, 6000]);
    const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
    expect(extension).toBeGreaterThan(-1);
    expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, 0, 0, 0]);
  });
}
