import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const [selection, comments] of [["[0]", "Alice;"], ["[1]", "Bob;"], ["", "Alice;Bob;"]]) {
    it(`preserves GIF comments on ${selection || "all frames"} (${mode})`, async () => {
      const fixture = spawnSync("magick", ["(", "-size", "3x2", "xc:red", "-set", "comment", "Alice", ")", "(", "-size", "3x2", "xc:blue", "-set", "comment", "Bob", ")", "-loop", "4", "gif:-"]);
      expect(fixture.status, fixture.stderr.toString()).toBe(0);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/labels.gif", fixture.stdout);
      const files = new Map([["labels.gif", new Uint8Array(fixture.stdout)]]);
      const args = [`labels.gif${selection}`, "out.gif"];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
      }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "buffered" ? files.get("out.gif")! : await fs.readFile("/out.gif");
      const actual = spawnSync("magick", ["identify", "-format", "%c;", "-"], { input: output, encoding: "utf8" });
      expect(actual.status, actual.stderr).toBe(0);
      expect(actual.stdout).toBe(comments);
    });
  }
}
