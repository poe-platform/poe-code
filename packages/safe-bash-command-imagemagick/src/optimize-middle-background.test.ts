import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  for (const disposal of ["Background", "None"]) {
    for (const options of [["-coalesce"], ["-coalesce", "-layers", "OptimizeFrame"], ["-layers", "Optimize"]]) {
      for (const pixels of [false, true]) {
        it(`${mode} preserves positioned middle ${disposal} disposal (${options.join(" ")}, pixels=${pixels})`, async () => {
          const args = ["-size", "1x1", "-delay", "7",
            "(", "xc:red", "-repage", "3x1+0+0", "-set", "dispose", "None", ")",
            "(", "xc:lime", "-repage", "3x1+1+0", "-set", "dispose", disposal, ")",
            "(", "xc:blue", "-repage", "3x1+2+0", "-set", "dispose", "None", ")",
            ...options, ...(pixels ? ["-coalesce", "-background", "white", "-alpha", "remove", "-depth", "8", "rgb:-"]
              : ["-format", "%wx%h:%g:%D:%T;", "info:"])];
          const filesystem = new MemoryFileSystem();
          const chunks: Uint8Array[] = [];
          let stderr = "";
          const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { write: async chunk => { chunks.push(new Uint8Array(chunk)); } },
            stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
          }) : mode === "sync" ? runConvertCliSync(args, new Map())
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : new Map());
          expect(result.exitCode).toBe(0);
          expect("stderr" in result ? result.stderr : stderr).toBe("");
          if (pixels) {
            const bytes = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
            expect(Buffer.from(bytes).toString("hex")).toBe("ff0000ffffffffffffff000000ff00ffffffff0000" +
              (disposal === "Background" ? "ffffff" : "00ff00") + "0000ff");
          } else {
            const secondDisposal = disposal === "Background" ? "Background" : "None";
            const second = options.length === 1 ? "3x1:3x1+0+0" : "1x1:3x1+1+0";
            const third = options.length === 1 ? "3x1:3x1+0+0" : "1x1:3x1+2+0";
            expect("stdout" in result ? result.stdout : Buffer.concat(chunks).toString()).toBe(
              `3x1:3x1+0+0:None:7;${second}:${secondDisposal}:7;${third}:${secondDisposal}:7;`);
          }
        });
      }
    }
  }
}
