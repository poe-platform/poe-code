import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runMogrifyCli } from "./index.js";

for (const format of ["tiff", "png"]) {
  const fixture = spawnSync("magick", ["-size", "2x1", "-depth", "8", "rgb:-", "-units", "PixelsPerInch", "-density", "144x72", `${format}:-`], { input: Uint8Array.of(255, 0, 0, 0, 0, 255) });
  for (const mode of ["buffered", "retained", "command", "mogrify"]) {
    it.each(["72x36", "288", "72x144"])(`resamples each density axis (${format}, ${mode}, %s)`, async density => {
      expect(fixture.status).toBe(0);
      const operations = ["-filter", "Point", "-resample", density];
      const native = spawnSync("magick", ["-", ...operations, `${format}:-`], { input: fixture.stdout });
      expect(native.status, native.stderr.toString()).toBe(0);
      const fs = new MemoryFileSystem();
      const input = `/input.${format}`, output = mode === "mogrify" ? input : `/output.${format}`;
      await fs.writeFile(input, fixture.stdout);
      const files = new Map([[input, new Uint8Array(fixture.stdout)]]);
      const args = [input, ...operations, output];
      if (mode === "command") {
        expect(await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args,
          cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} } })).toMatchObject({ exitCode: 0 });
      } else {
        const result = mode === "mogrify"
          ? await runMogrifyCli([...operations, input], { filesystem: fs, cwd: "/" })
          : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const bytes = mode === "buffered" ? files.get(output)! : await fs.readFile(output);
      const inspect = (input: Uint8Array) => spawnSync("magick", ["identify", "-quiet", "-format", "%wx%h|%x,%y,%U", "-"], { input, encoding: "utf8" });
      expect(inspect(bytes).stdout).toBe(inspect(native.stdout).stdout);
      const pixels = (input: Uint8Array) => spawnSync("magick", ["-", "-depth", "8", "rgb:-"], { input }).stdout;
      expect(pixels(bytes)).toEqual(pixels(native.stdout));
    });
  }
}
