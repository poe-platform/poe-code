import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
 for (const [color, expected] of [
  ["#b66829", "srgb(40.1961%,32.549%,25.4902%)"],
  ["#b56829", "srgb(102,83,65)"],
  ["#b56929", "srgb(40%,32.7451%,25.4902%)"],
  ["#b5682a", "srgb(40%,32.549%,25.6863%)"],
 ]) it(`reports the merged mean for ${color} (${mode})`, async () => {
  const args = ["xc:#173e59", `xc:${color}`, "+append", "-fuzz", "80%", "-define", "connected-components:verbose=true", "-connected-components", "4", "null:"];
  const fs = new MemoryFileSystem();
  let stdout = "", stderr = "";
  const commandResult = mode === "command" ? await createMagickCommand().execute({
   command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
   stdin: (async function* () {})(), signal: new AbortController().signal,
   stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
   stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
  }) : undefined;
  const result = commandResult ? { exitCode: commandResult.exitCode, stdout, stderr } : mode === "sync" ? runConvertCliSync(args, new Map()) : await runConvertCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: `Objects (id: bounding-box centroid area mean-color):\n  0: 2x1+0+0 0.5,0.0 2 ${expected}\n` });
 });
}
