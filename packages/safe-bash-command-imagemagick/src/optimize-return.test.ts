import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  for (const operation of ["OptimizeFrame", "OptimizePlus", "Optimize"]) {
    it.each([
      { color: "red", transparent: false }, { color: "lime", transparent: false },
      { color: "red", transparent: true }, { color: "lime", transparent: true },
    ])(`${mode} ${operation} returns to $color (transparent=$transparent)`, async ({ color, transparent }) => {
      const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
      const argv = [...(transparent
        ? ["-size", "1x2", "-delay", "5", "(", "xc:red", "xc:none", "xc:red", "+append", ")",
          "-delay", "6", "(", "xc:blue", "xc:none", "xc:blue", "+append", ")",
          "-delay", "7", "(", `xc:${color}`, "xc:none", `xc:${color}`, "+append", ")", "-repage", "3x2+0+0"]
        : ["-size", "3x2", "-delay", "5", "xc:red", "-delay", "6", "xc:blue", "-delay", "7", `xc:${color}`]),
        "-layers", operation, "-write", "out.gif", "-format", "%wx%h %g %T %D;", "info:"];
      let stdout = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} },
      }) : mode === "sync" ? runMagickCliSync(argv, files)
        : await runMagickCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      expect("stdout" in result ? result.stdout : stdout).toBe(color === "red"
        ? "3x2 3x2+0+0 5 None;3x2 3x2+0+0 6 Previous;1x1 3x2-1-1 7 Previous;"
        : "3x2 3x2+0+0 5 None;3x2 3x2+0+0 6 None;3x2 3x2+0+0 7 None;");
      const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
      const decoded = decodeImage(bytes, { animated: true });
      expect(decoded.delay).toEqual([50, 60, 70]);
      expect(Array.from(decoded.data)).toEqual([[255, 0, 0, 255], [0, 0, 255, 255], color === "red" ? [255, 0, 0, 255] : [0, 255, 0, 255]].flatMap(pixel => transparent ? [pixel, [0, 0, 0, 0], pixel, pixel, [0, 0, 0, 0], pixel].flat() : Array(6).fill(pixel).flat()));
      if (color === "red") expect(decodeImage(bytes, { page: 2, coalesce: false })).toMatchObject({ width: 1, height: 1, disposal: 3 });
    });
  }
}
