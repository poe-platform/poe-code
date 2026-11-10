import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const [name, options, expected] of [
    ["centimeter units", ["-units", "PixelsPerCentimeter"], "28.346456692913385|28.346456692913385|PixelsPerCentimeter"],
    ["set centimeter units", ["-set", "units", "PixelsPerCentimeter"], "28.346456692913385|28.346456692913385|PixelsPerCentimeter"],
    ["inch units", ["-units", "PixelsPerInch"], "72|72|PixelsPerInch"],
    ["default units", [], "72|72|Undefined"],
    ["explicit density", ["-density", "72", "-units", "PixelsPerCentimeter"], "72|72|PixelsPerCentimeter"],
  ] as const) {
    it(`formats ${name} on a synthetic canvas (${mode})`, async () => {
      const fs = new MemoryFileSystem();
      const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
      await fs.writeFile("/out", files.get("/out")!);
      const args = ["xc:red", ...options, "-format", "%x|%y|%U", "info:/out"];
      const result = mode === "command"
        ? await createMagickCommand().execute({ command: "magick", args: createCommandArguments(args).args,
          cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} } })
        : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      expect(new TextDecoder().decode(mode === "buffered" ? files.get("/out")! : await fs.readFile("/out"))).toBe(expected);
    });
  }
}
