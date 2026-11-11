import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  for (const method of ["OptimizeFrame", "OptimizePlus"]) {
    it.each([
      { colors: ["none", "red"], append: "+append", page: "2x1", x: 1, y: 0, native: "R0lGODlhAgABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQMBQAAACwAAAAAAgABAAACAgQKACH5BAwGAAAALAEAAAABAAEAAAICRAEAOw==" },
      { colors: ["red", "none"], append: "+append", page: "2x1", x: 0, y: 0, native: "R0lGODlhAgABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQMBQAAACwAAAAAAgABAAACAgQKACH5BAwGAAAALAAAAAABAAEAAAICRAEAOw==" },
      { colors: ["none", "red"], append: "-append", page: "1x2", x: 0, y: 1, native: "R0lGODlhAQACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQMBQAAACwAAAAAAQACAAACAgQKACH5BAwGAAAALAAAAQABAAEAAAICRAEAOw==" },
      { colors: ["red", "none"], append: "-append", page: "1x2", x: 0, y: 0, native: "R0lGODlhAQACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQMBQAAACwAAAAAAQACAAACAgQKACH5BAwGAAAALAAAAAABAAEAAAICRAEAOw==" },
      { colors: ["blue", "red"], append: "+append", page: "2x1", x: 0, y: 0 },
    ])(`${mode} ${method} optimizes $colors with $append`, async ({ colors, append, page, x, y, native }) => {
      const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
      const args = ["-size", "1x1", "-delay", "5", "(", "xc:red", "xc:red", append, ")",
        "-delay", "6", "(", ...colors.map(color => `xc:${color}`), append, ")", "-repage", `${page}+0+0`,
        "-layers", method, "-write", "out.gif", "-format", "%wx%h %g %T %D;", "info:"];
      let stdout = "", stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
        stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
      }) : mode === "sync" ? runConvertCliSync(args, files)
        : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      const clearing = colors.includes("none"), disposal = clearing ? "Previous" : "None";
      expect("stdout" in result ? result.stdout : stdout).toBe(`${page} ${page}+0+0 5 ${disposal};1x1 ${page}+${x}+${y} 6 ${disposal};`);
      const bytes = mode === "command" || mode === "retained" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
      expect(decodeImage(bytes, { page: 1, coalesce: false })).toMatchObject({ width: 1, height: 1, disposal: clearing ? 3 : 1,
        virtualCanvas: { x, y }, data: new Uint8Array(clearing ? [255, 0, 0, 255] : [0, 0, 255, 255]) });
      const decoded = decodeImage(bytes, { animated: true });
      expect(decoded.delay).toEqual([50, 60]);
      if (native) {
        const background = 13 + bytes[11]! * 3;
        expect([...bytes.slice(background, background + 3)]).toEqual([255, 0, 0]);
        expect(decoded.data).toEqual(decodeImage(Buffer.from(native, "base64"), { animated: true }).data);
      } else expect(decoded.data).toEqual(new Uint8Array([
        255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255,
      ]));
    });
  }
}
