import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  for (const method of ["OptimizeFrame", "OptimizePlus", "Optimize"]) {
    it.each([
      { colors: ["none", "red"], append: "+append", page: "2x1", first: "1x1 2x1+1+0", second: "2x1 2x1+0+0" },
      { colors: ["red", "none"], append: "+append", page: "2x1", first: "1x1 2x1+0+0", second: "2x1 2x1+0+0" },
      { colors: ["none", "red"], append: "-append", page: "1x2", first: "1x1 1x2+0+1", second: "1x2 1x2+0+0" },
      { colors: ["red", "none"], append: "-append", page: "1x2", first: "1x1 1x2+0+0", second: "1x2 1x2+0+0" },
      { colors: ["red", "blue"], append: "+append", page: "2x1", first: "2x1 2x1+0+0", second: "1x1 2x1+0+0" },
    ])(`${mode} ${method} crops initial $colors with $append`, async ({ colors, append, page, first, second }) => {
      const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const input = ["-size", "1x1", "-delay", "5", "(", ...colors.map(color => `xc:${color}`), append, ")",
        "-delay", "6", "(", "xc:blue", "xc:blue", append, ")", "-repage", `${page}+0+0`, "-layers", method];
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
        exitCode: 0, stderr: "", stdout: `${first} 5 None;${second} 6 None;`,
      });
      expect(await run(["out.gif"])).toMatchObject({ exitCode: 0, stderr: "" });
      const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
      const decoded = decodeImage(bytes, { animated: true });
      expect(decoded.delay).toEqual([50, 60]);
      expect(decoded.data).toEqual(new Uint8Array([
        ...colors.flatMap(color => color === "red" ? [255, 0, 0, 255] : color === "blue" ? [0, 0, 255, 255] : [0, 0, 0, 0]),
        0, 0, 255, 255, 0, 0, 255, 255,
      ]));
    });
  }
}
