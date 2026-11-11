import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 rejects width plus offsets without a tick-rate field.
for (const mode of ["command", "filesystem", "map", "sync"] as const) {
  for (const option of ["-delay", "-loop"]) {
    it.each(["12+1+2", "12 +1 +2", "12x25+1+2"])(`${mode} validates ${option} %s before emitting GIF bytes`, async value => {
      const args = [option, value, "xc:red", "xc:blue", "gif:-"];
      const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const argumentValues = createCommandArguments(args), chunks: Uint8Array[] = [];
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
      const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
      if (value !== "12x25+1+2") {
        expect(result.exitCode).toBe(1);
        expect("stderr" in result ? result.stderr : stderr).toContain(`invalid argument for option '${option}'`);
        expect(output.byteLength).toBe(0);
        return;
      }
      expect(result.exitCode).toBe(0);
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      expect(decodeImage(output, { animated: true }).delay).toEqual(option === "-delay" ? [480, 480] : [0, 0]);
      const extension = Buffer.from(output).indexOf("NETSCAPE2.0");
      expect(extension).toBeGreaterThan(-1);
      expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, option === "-loop" ? 11 : 0, 0, 0]);
    });
  }
}
