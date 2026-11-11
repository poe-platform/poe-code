import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "command", "sync"]) {
  for (const operation of ["OptimizeFrame", "OptimizePlus"]) {
    it.each([
      { page: "4x2+0+0", size: "2x1", error: "" },
      { page: "1x1+0+0", size: "2x1", error: "" },
      { page: "2x1+0+0", size: "2x1", error: "" },
      { page: "4x2+1+0", size: "2x1", error: "image pages are not coalesced" },
      { page: "1x1+0+1", size: "2x1", error: "image pages are not coalesced" },
      { page: "4x2+0+0", size: "1x1", error: operation === "OptimizePlus" ? "images are not the same size" : "image pages are not coalesced" },
    ])(`${mode} ${operation} validates raster sizes and offsets on $page ($size)`, async ({ page, size, error }) => {
      const args = ["-size", "2x1", "xc:red", "-size", size, "xc:blue", "-repage", page,
        "-layers", operation, "-format", "%wx%h %g %D;", "info:"];
      const filesystem = new MemoryFileSystem();
      let stdout = "", stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
        stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
      }) : mode === "sync" ? runConvertCliSync(args, new Map()) : await runConvertCli(args,
        mode === "retained" ? { filesystem, cwd: "/" } : new Map());
      expect(result.exitCode).toBe(error ? 1 : 0);
      expect("stderr" in result ? result.stderr : stderr).toEqual(error ? expect.stringContaining(error) : "");
      expect("stdout" in result ? result.stdout : stdout).toBe(error ? "" : `2x1 ${page} None;2x1 ${page} None;`);
    });
  }
}
