import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  for (const operation of ["OptimizeFrame", "OptimizePlus"]) {
    it.each([{ page: [] }, { page: ["+repage"] }, { page: ["-repage", "2x1+0+0"] }])(`${mode} ${operation} restores the frame canvas ($page)`, async ({ page }) => {
      const filesystem = new MemoryFileSystem();
      const args = ["-size", "2x1", "xc:red", "xc:blue", ...page, "-layers", operation, "-format", "%wx%h %g %D;", "info:"];
      let stdout = "", stderr = "";
      const result = mode === "command" ? {
        ...await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
          stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }), stdout, stderr,
      } : mode === "sync" ? runConvertCliSync(args, new Map())
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
      expect(result).toMatchObject({ exitCode: 0, stderr: "", stdout: "2x1 2x1+0+0 None;2x1 2x1+0+0 None;" });
    });
  }
}
