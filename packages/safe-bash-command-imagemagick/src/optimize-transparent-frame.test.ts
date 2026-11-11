import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const method of ["OptimizePlus", "OptimizeFrame", "Optimize"]) {
    it.each(["none", "blue"])(`${mode} ${method} preserves native replacement playback for %s`, async color => {
      const files = new Map<string, Uint8Array>();
      const filesystem = new MemoryFileSystem();
      const input = ["-size", "3x2", "-delay", "5", "xc:red", "-delay", "6", `xc:${color}`, "-layers", method];
      const run = async (output: string[]) => {
        const args = [...input, ...output];
        let stdout = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async chunk => { stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); } },
          stderr: { write: async () => {} },
        }) : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        return "stdout" in result ? result.stdout : stdout;
      };
      const pause = color === "none" && method !== "Optimize";
      expect(await run(["-format", "%wx%h %g %T %D;", "info:"])).toBe(pause
        ? "3x2 3x2+0+0 5 Previous;1x1 3x2-1-1 6 Previous;"
        : color === "none" ? "3x2 3x2+0+0 5 None;1x1 3x2-1-1 6 None;"
        : "3x2 3x2+0+0 5 None;3x2 3x2+0+0 6 None;");
      await run(["out.gif"]);
      const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
      const decoded = decodeImage(bytes, { animated: true });
      expect(decoded.delay).toEqual([50, 60]);
      if (pause) {
        // Native ImageMagick output: the decoder must see the same frames and disposal.
        const background = bytes[11]! * 3 + 13;
        expect([...bytes.slice(background, background + 3)]).toEqual([255, 0, 0]);
        const native = Buffer.from("R0lGODlhAwACAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQMBQAAACwAAAAAAwACAAACAoRfACH5BA0GAAAALAAAAAABAAEAgAAAAAAAAAICRAEAOw==", "base64");
        expect(decoded.data).toEqual(decodeImage(native, { animated: true }).data);
        expect(decodeImage(bytes, { page: 1, coalesce: false })).toMatchObject({ width: 1, height: 1, disposal: 3 });
      } else expect([...decoded.data.slice(24, 28)]).toEqual(color === "blue" ? [0, 0, 255, 255] : [255, 0, 0, 255]);
    });
  }
}

for (const method of ["OptimizeFrame", "OptimizePlus"]) {
  it.each([false, true])(`${method} keeps surrounding transparent and opaque frames (retained=%s)`, async retained => {
    for (const [input, expected] of [
      [["xc:none", "xc:none"], "1x1 None;1x1 None;"],
      [["xc:red", "xc:none", "xc:blue"], "3x2 Previous;1x1 None;3x2 None;"],
    ] as const) {
      const result = await runConvertCli(["-size", "3x2", ...input, "-layers", method, "-format", "%wx%h %D;", "info:"],
        retained ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map());
      expect(result).toMatchObject({ exitCode: 0, stdout: expected });
    }
  });
}
