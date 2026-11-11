import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  for (const operation of ["OptimizeFrame", "OptimizePlus", "Optimize"]) {
    it.each([false, true])(`${mode} ${operation} preserves initial playback (opaque=%s)`, async opaque => {
      const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const input = ["-size", "3x2", "-delay", "5", opaque ? "xc:red" : "xc:none", "-delay", "6", "xc:blue", "-layers", operation];
      const run = async (output: string[]) => {
        const args = [...input, ...output];
        let stdout = "", stderr = "";
        if (mode === "command") {
          const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
            stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
          });
          return { ...result, stdout, stderr };
        }
        return mode === "sync" ? runConvertCliSync(args, files)
          : runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      };
      expect(await run(["-format", "%wx%h %g %T %D;", "info:"])).toMatchObject({
        exitCode: 0, stderr: "", stdout: `${opaque ? "3x2 3x2+0+0" : "1x1 3x2-1-1"} 5 None;3x2 3x2+0+0 6 None;`,
      });
      expect(await run(["out.gif"])).toMatchObject({ exitCode: 0, stderr: "" });
      const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
      expect(decodeImage(bytes, { page: 0, coalesce: false })).toMatchObject({ width: opaque ? 3 : 1, height: opaque ? 2 : 1 });
      const decoded = decodeImage(bytes, { animated: true });
      expect(decoded.delay).toEqual([50, 60]);
      expect(decoded.data).toEqual(new Uint8Array([
        ...Array.from({ length: 6 }, () => opaque ? [255, 0, 0, 255] : [0, 0, 0, 0]).flat(),
        ...Array.from({ length: 6 }, () => [0, 0, 255, 255]).flat(),
      ]));
    });
  }
}
