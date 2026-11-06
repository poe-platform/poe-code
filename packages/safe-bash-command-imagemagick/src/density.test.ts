import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const extension of ["png", "jpg", "tiff"]) {
  const fixture = spawnSync("magick", ["-size", "2x1", "xc:red", "-units", "PixelsPerInch", "-density", "144x72", "-orient", "RightTop", `${extension}:-`]);
  for (const mode of ["buffered", "retained", "command"]) {
    it.each([false, true])(`preserves both density axes in ${extension} (${mode}, flop=%s)`, async flop => {
      expect(fixture.status, fixture.stderr.toString()).toBe(0);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", fixture.stdout);
      const files = new Map([["/input", new Uint8Array(fixture.stdout)]]);
      const path = `/output.${extension}`, args = ["/input", ...(flop ? ["-flop"] : []), path];
      if (mode === "command") {
        const result = await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args,
          cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} } });
        expect(result).toMatchObject({ exitCode: 0 });
      } else {
        expect(await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const output = mode === "buffered" ? files.get(path)! : await fs.readFile(path);
      const inspect = (input: Uint8Array) => spawnSync("magick", ["identify", "-quiet", "-format", "%x,%y,%U", "-"], { input, encoding: "utf8" });
      const actual = inspect(output), expected = inspect(fixture.stdout);
      expect(actual.status, actual.stderr).toBe(0);
      expect(actual.stdout).toBe(expected.stdout);
      if (extension === "png") {
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        let physical: number[] | undefined;
        for (let offset = 8; offset + 12 <= output.length; offset += view.getUint32(offset) + 12) {
          if (view.getUint32(offset + 4) === 0x70485973) {
            physical = [view.getUint32(offset + 8), view.getUint32(offset + 12), output[offset + 16]!];
          }
        }
        expect(physical).toEqual([5669, 2834, 1]);
      }
    });
  }
}
