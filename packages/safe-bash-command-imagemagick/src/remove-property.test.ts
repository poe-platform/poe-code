import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runMogrifyCli } from "./index.js";

for (const mode of ["buffered", "retained", "command", "mogrify"]) {
  for (const property of ["comment", "label", "asset", "missing"]) {
    it(`removes only ${property} through ${mode}`, async () => {
      const fixture = spawnSync("magick", ["-size", "2x1", "xc:red", "-set", "comment", "old-note", "-set", "label", "old-label", "-set", "asset", "old-code", "png:-"]);
      expect(fixture.status).toBe(0);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", fixture.stdout);
      const files = new Map([["/input.png", new Uint8Array(fixture.stdout)]]);
      const outputPath = mode === "mogrify" ? "/input.png" : "/output.png";
      const args = ["/input.png", "+set", property, outputPath];
      if (mode === "command") {
        expect(await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} }
        })).toMatchObject({ exitCode: 0 });
      } else {
        const result = mode === "mogrify"
          ? await runMogrifyCli(["+set", property, outputPath], { filesystem: fs, cwd: "/" })
          : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const output = mode === "buffered" ? files.get(outputPath)! : await fs.readFile(outputPath);
      const native = spawnSync("magick", ["identify", "-quiet", "-format", "%wx%h|%[comment]|%[label]|%[asset]", "-"], { input: output, encoding: "utf8" });
      expect(native.status, native.stderr).toBe(0);
      expect(native.stdout).toBe(`2x1|${property === "comment" ? "" : "old-note"}|${property === "label" ? "" : "old-label"}|${property === "asset" ? "" : "old-code"}`);
    });
  }
}
