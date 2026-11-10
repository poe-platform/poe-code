import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const name of ["demo", "demo:key"]) {
    it.each([
      { edits: ["-set", `option:${name}`, "amber"], output: "amber|amber|amber", warnings: [] },
      { edits: ["-set", name, "amber"], output: "amber||", warnings: [`option:${name}`, `artifact:${name}`] },
      { edits: ["-set", `option:${name}`, "amber", "-set", `artifact:${name}`, "blue"], output: "blue|amber|blue", warnings: [] },
      { edits: ["-set", `option:${name}`, "amber", "-set", name, "green"], output: "green|amber|amber", warnings: [] },
      { edits: ["-set", `option:${name}`, ""], output: "||", warnings: [] }
    ])(`resolves ${name} option and artifact namespaces (${mode}): $edits`, async ({ edits, output, warnings }) => {
      const args = ["xc:red", ...edits, "-format", `%[${name}]|%[option:${name}]|%[artifact:${name}]`, "info:-"];
      const fs = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      let result;
      if (mode === "command") {
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        result = { ...status, stdout, stderr };
      } else {
        result = mode === "sync" ? runMagickCliSync(args, files)
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      }
      expect(result).toEqual({
        exitCode: 0, stdout: output,
        stderr: warnings.map(key => `magick: unknown image property '%[${key}]'\n`).join("")
      });
    });
  }
}
