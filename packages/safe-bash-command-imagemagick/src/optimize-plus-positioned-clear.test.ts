import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  for (const vertical of [false, true]) {
    it.each(["Background", "None"])(`${mode} optimizes positioned frames with middle %s disposal (vertical=${vertical})`, async disposal => {
      const canvas = vertical ? "1x3" : "3x1";
      const middle = vertical ? "+0+1" : "+1+0", last = vertical ? "+0+2" : "+2+0";
      const input = ["-size", "1x1", "-delay", "7",
        "(", "xc:red", "-repage", `${canvas}+0+0`, "-set", "dispose", "None", ")",
        "(", "xc:lime", "-repage", `${canvas}${middle}`, "-set", "dispose", disposal, ")",
        "(", "xc:blue", "-repage", `${canvas}${last}`, "-set", "dispose", "None", ")", "-coalesce"];
      const filesystem = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
      const run = async (output: string[]) => {
        const args = [...input, ...output];
        let stdout = "", stderr = "";
        const chunks: Uint8Array[] = [];
        if (mode === "command") {
          const result = await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { chunks.push(chunk.slice()); stdout += new TextDecoder().decode(chunk); } },
            stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
          });
          return { ...result, stdout, stderr, stdoutBytes: Buffer.concat(chunks) };
        }
        return mode === "sync" ? runConvertCliSync(args, files)
          : runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      };
      const pixels = disposal === "Background"
        ? "ff0000ffffffffffffff000000ff00ffffffff0000ffffff0000ff"
        : "ff0000ffffffffffffff000000ff00ffffffff000000ff000000ff";
      for (const optimize of [false, true]) {
        const result = await run([...(optimize ? ["-layers", "OptimizePlus", "-coalesce"] : []),
          "-background", "white", "-alpha", "remove", "-depth", "8", "rgb:-"]);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe(pixels);
      }
      expect(await run(["-layers", "OptimizePlus", "-format", "%wx%h:%g:%D:%T;", "info:"])).toMatchObject({
        exitCode: 0, stderr: "",
        stdout: `${canvas}:${canvas}+0+0:None:7;1x1:${canvas}${middle}:${disposal}:7;1x1:${canvas}${last}:${disposal}:7;`,
      });
    });
  }
}
