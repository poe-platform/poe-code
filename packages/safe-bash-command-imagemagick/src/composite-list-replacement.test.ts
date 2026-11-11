import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const route of ["sync", "buffered", "retained", "command"] as const) {
  for (const { before, after, expected } of [
    { before: ["xc:red", "xc:lime"], after: [], expected: "00ff00" },
    { before: ["xc:red", "xc:lime", "xc:blue"], after: [], expected: "ed1200" },
    { before: ["xc:red", "xc:lime", "xc:blue", "xc:white"], after: [], expected: "ed1200" },
    { before: ["xc:red", "xc:lime", "xc:blue", "xc:white", "xc:cyan"], after: [], expected: "ed1200" },
    { before: ["xc:red", "xc:lime", "xc:blue"], after: ["xc:white"], expected: "ed1200ffffff" },
    { before: ["xc:red", "xc:lime", "xc:blue", "xc:white", "xc:cyan"], after: ["xc:white"], expected: "ed1200ffffff" },
  ]) {
    it(`${route}: composite replaces ${before.length} inputs and preserves ${after.length} later inputs`, async () => {
      const args = [...before, "-composite", ...after, "+append", "-depth", "8", "rgb:-"];
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      let output: Uint8Array;
      if (route === "command") {
        const chunks: number[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(chunk) { chunks.push(...chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
        });
        expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = Uint8Array.from(chunks);
      } else {
        const result = route === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, route === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = result.stdoutBytes!;
      }
      expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
  }
}
