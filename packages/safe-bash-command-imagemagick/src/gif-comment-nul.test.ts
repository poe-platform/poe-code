import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const [name, blocks, expected] of [
    ["embedded NUL", [3, 97, 0, 98, 0], [97]],
    ["ASCII control", [1, 97, 0], [97]],
    ["NUL across sub-blocks", [1, 97, 2, 0, 98, 0], [97]],
    ["leading NUL", [2, 0, 98, 0], []]
  ] as const) {
    it(`rewrites GIF comment bytes: ${name} (${mode})`, async () => {
      const fixture = spawnSync("magick", ["-size", "2x1", "-delay", "7", "xc:red", "-delay", "13", "xc:blue", "-loop", "4", "gif:-"]);
      expect(fixture.status, fixture.stderr.toString()).toBe(0);
      const offset = 13 + 3 * (1 << ((fixture.stdout[10]! & 7) + 1));
      const bytes = Buffer.concat([fixture.stdout.subarray(0, offset), Buffer.from([33, 254, ...blocks]), fixture.stdout.subarray(offset)]);
      const native = spawnSync("magick", ["gif:-", "gif:-"], { input: bytes });
      expect(native.status, native.stderr.toString()).toBe(0);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.gif", bytes);
      const files = new Map<string, Uint8Array>([["in.gif", bytes]]);
      const args = ["in.gif", "out.gif"];
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
      }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "buffered" ? files.get("out.gif")! : await fs.readFile("/out.gif");
      // These tiny solid-color fixtures cannot contain this marker in pixel data.
      for (const rewritten of [native.stdout, Buffer.from(output)]) {
        const start = rewritten.indexOf(Buffer.from([33, 254]));
        expect(start).toBeGreaterThan(-1);
        const block = expected.length ? [expected.length, ...expected, 0] : [0];
        expect([...rewritten.subarray(start + 2, start + 2 + block.length)]).toEqual(block);
      }
    });
  }
}
