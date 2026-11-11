import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const operation of [[], ["-flatten"], ["-mosaic"], ["-layers", "flatten"], ["-layers", "mosaic"], ["-layers", "merge"]]) {
    it.each([
      { input: ["-delay", "3x25", "xc:red", "xc:blue"], ticks: [3, 3], delays: [120, 120], edited: [200, 200] },
      { input: ["-delay", "3x25", "xc:red", "(", "-delay", "7x50", "xc:blue", ")", "-reverse"], ticks: [7, 3], delays: [140, 120], edited: [100, 200] },
      { input: ["-delay", "1x1000000", "xc:red", "xc:blue"], ticks: [1, 1], delays: [0, 0], edited: [0, 0] },
    ])(`${mode} ${operation.join(" ") || "control"} retains original delay ticks and rate: $input`, async ({ input, ticks, delays, edited }) => {
      const files = new Map<string, Uint8Array>();
      const fs = new MemoryFileSystem();
      const args = [...input, ...operation, "-write", "/original.gif", "-format", "%T,", "-write", "info:/ticks",
        "-set", "delay", "5", "/edited.gif"];
      let stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} },
        stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
      }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result.exitCode).toBe(0);
      expect("stderr" in result ? result.stderr : stderr).toBe("");
      const count = operation.length ? 1 : 2;
      const read = async (path: string) => mode === "buffered" || mode === "sync" ? files.get(path)! : fs.readFile(path);
      expect.soft(new TextDecoder().decode(await read("/ticks"))).toBe(ticks.slice(0, count).map(tick => `${tick},`).join(""));
      expect(decodeImage(await read("/original.gif"), { animated: true }).delay).toEqual(delays.slice(0, count));
      expect(decodeImage(await read("/edited.gif"), { animated: true }).delay).toEqual(edited.slice(0, count));
    });
  }
}
