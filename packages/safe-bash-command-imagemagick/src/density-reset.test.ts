import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

for (const mode of ["buffered", "retained", "command"]) {
  for (const [name, options, expected] of [
    ["reset explicit density", ["-density", "120", "+density"], "72/72;"],
    ["reset default density", ["+density"], "72/72;"],
    ["explicit density", ["-density", "120"], "120/120;"],
    ["default density", [], "72/72;"],
  ] as const) {
    it(`${name} before reading a canvas (${mode})`, async () => {
      const fs = new MemoryFileSystem();
      const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
      await fs.writeFile("/out", files.get("/out")!);
      const args = [...options, "xc:red", "-format", "%x/%y;", "info:/out"];
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
