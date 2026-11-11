import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: ["-set", "option:t", "12", "-loop", "%[option:t]", "xc:red", "xc:blue"], repeat: 11, delay: [0, 0] },
    { args: ["-set", "option:t", "12", "-loop", "12", "xc:red", "xc:blue"], repeat: 11, delay: [0, 0] },
    { args: ["xc:red", "xc:blue", "-set", "option:t", "12", "-loop", "%[option:t]"], repeat: 11, delay: [0, 0] },
    { args: ["-loop", "3", "xc:red", "+loop", "xc:blue"], repeat: 0, delay: [0, 0] },
    { args: ["-loop", "3", "xc:red", "xc:blue"], repeat: 2, delay: [0, 0] },
    { args: ["xc:red", "xc:blue"], repeat: 0, delay: [0, 0] },
    { args: ["-loop", "3", "-delay", "7", "xc:red", "-delay", "13", "xc:blue", "+loop"], repeat: 0, delay: [70, 130] },
    { args: ["-loop", "3", "xc:red", "+loop", "xc:blue", "-loop", "4"], repeat: 3, delay: [0, 0] }
  ])(`writes GIF repeat count $repeat for $args (${mode})`, async ({ args, repeat, delay }) => {
    const argv = [...args, "gif:-"];
    const fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? Buffer.concat(chunks)
      : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    const extension = output.indexOf("NETSCAPE2.0");
    expect(extension).toBeGreaterThan(-1);
    expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, repeat, 0, 0]);
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay });
    expect(await sharp(output, { animated: true }).raw().toBuffer())
      .toEqual(Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255));
  });
}
