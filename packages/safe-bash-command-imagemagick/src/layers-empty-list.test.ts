import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const methods = ["TrimBounds", "Coalesce", "Dispose", "CompareAny", "CompareOverlay", "CompareClear", "OptimizeTransparency", "RemoveDups", "RemoveZero", "OptimizePlus", "OptimizeFrame", "Optimize"];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const ordering of ["empty", "deleted", "valid"] as const) {
    it.each(methods)(`${mode} handles ${ordering} image list for -layers %s`, async method => {
      const before = ordering === "deleted" ? ["xc:blue", "-delete", "0"] : ordering === "valid" ? ["xc:red"] : [];
      const args = [...before, "-layers", method, ...(ordering === "valid" ? [] : ["xc:red"]), "-depth", "8", "rgba:out"];
      const keep = new TextEncoder().encode("KEEP");
      const files = new Map([["out", keep]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/out", keep);
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async chunk => { stderr += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
      }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(ordering === "valid" ? 0 : 1);
      if (ordering !== "valid") expect("stderr" in result ? result.stderr : stderr).toContain("no images found for operation '-layers'");
      const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("out");
      expect(output).toEqual(ordering === "valid" ? new Uint8Array([255, 0, 0, 255]) : keep);
    });
  }
}
