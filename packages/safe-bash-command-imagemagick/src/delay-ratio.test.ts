import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  for (const setting of [false, true]) {
    it.each([["8:2", 4000], ["4x1", 4000], ["5:2", 3000]] as const)(`${mode} encodes delay %s (set=${setting})`, async (value, delay) => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      const args = setting ? ["xc:red", "xc:blue", "-set", "delay", value, "gif:-"]
        : ["-delay", value, "xc:red", "xc:blue", "gif:-"];
      const chunks: Uint8Array[] = [];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write() {} },
      }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result.exitCode).toBe(0);
      const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array
        ? Buffer.from(result.stdoutBytes) : Buffer.concat(chunks);
      expect(decodeImage(output, { animated: true }).delay).toEqual([delay, delay]);
      const extension = output.indexOf("NETSCAPE2.0");
      expect(extension).toBeGreaterThan(-1);
      expect([...output.subarray(extension + 11, extension + 16)]).toEqual([3, 1, 0, 0, 0]);
    });
  }
}
