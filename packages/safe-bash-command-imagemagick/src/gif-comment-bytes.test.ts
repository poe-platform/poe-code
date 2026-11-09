import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const comment of [Uint8Array.of(99, 97, 102, 233), new TextEncoder().encode("café"), Uint8Array.of(65, 66, 67)]) {
    for (const edit of [[], ["-strip"], ["-set", "comment", "changed"]]) {
      it(`preserves GIF comment bytes ${comment} (${mode}, ${edit.join(" ")})`, async () => {
        const fixture = spawnSync("magick", ["-size", "2x1", "-delay", "7", "xc:red", "-delay", "13", "xc:blue", "-loop", "4", "gif:-"]);
        expect(fixture.status, fixture.stderr.toString()).toBe(0);
        const offset = 13 + ((fixture.stdout[10]! & 128) ? 3 * (1 << ((fixture.stdout[10]! & 7) + 1)) : 0);
        const extension = Uint8Array.of(33, 254, comment.length, ...comment, 0);
        const bytes = new Uint8Array(fixture.stdout.length + extension.length);
        bytes.set(fixture.stdout.subarray(0, offset));
        bytes.set(extension, offset);
        bytes.set(fixture.stdout.subarray(offset), offset + extension.length);
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.gif", bytes);
        const files = new Map([["in.gif", bytes]]);
        const args = ["in.gif", ...edit, "out.gif"];
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} }
        }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "buffered" ? files.get("out.gif")! : await fs.readFile("/out.gif");
        const actual = spawnSync("magick", ["identify", "-format", "%c;", "-"], { input: output });
        expect(actual.status, actual.stderr.toString()).toBe(0);
        const expected = edit[0] === "-strip" ? Buffer.from(";;") : edit.length ? Buffer.from("changed;changed;") : Buffer.concat([comment, Buffer.from(";;")]);
        expect(actual.stdout).toEqual(expected);
      });
    }
  }
}
