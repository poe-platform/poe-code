import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const strip of [false, true]) {
    it(`uses the last GIF comment extension (${mode}, strip=${strip})`, async () => {
      const fixture = spawnSync("magick", ["-size", "2x1", "-delay", "7", "xc:red", "-delay", "13", "xc:blue", "-loop", "4", "gif:-"]);
      expect(fixture.status, fixture.stderr.toString()).toBe(0);
      const offset = 13 + ((fixture.stdout[10]! & 128) ? 3 * (1 << ((fixture.stdout[10]! & 7) + 1)) : 0);
      const extensions = Uint8Array.of(33, 254, 5, ...new TextEncoder().encode("first"), 0, 33, 254, 3, ...new TextEncoder().encode("sec"), 3, ...new TextEncoder().encode("ond"), 0);
      const bytes = new Uint8Array(fixture.stdout.length + extensions.length);
      bytes.set(fixture.stdout.subarray(0, offset));
      bytes.set(extensions, offset);
      bytes.set(fixture.stdout.subarray(offset), offset + extensions.length);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/labels.gif", bytes);
      const files = new Map([["labels.gif", bytes]]);
      const args = ["labels.gif", ...(strip ? ["-strip"] : []), "out.gif"];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
      }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "buffered" ? files.get("out.gif")! : await fs.readFile("/out.gif");
      const actual = spawnSync("magick", ["identify", "-format", "%c;", "-"], { input: output, encoding: "utf8" });
      expect(actual.status, actual.stderr).toBe(0);
      expect(actual.stdout).toBe(strip ? ";;" : "second;;");
    });
  }
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
