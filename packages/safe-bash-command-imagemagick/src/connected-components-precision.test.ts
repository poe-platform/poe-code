import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
 for (const [precision, channel, axis] of [["2", "2.6e+02", "1.5"], ["1", "3e+02", "2"], ["6", "255", "1.54919"], ["0", "255", "1.54919"]]) {
  it(`formats component colors and measurements with precision ${precision} (${mode})`, async () => {
   const bytes = await sharp(Uint8Array.from([0,0,255, 255,0,0, 255,0,0, 255,0,0, 255,0,0, 255,0,0]), { raw: { width: 3, height: 2, channels: 3 } }).png().toBuffer();
   const files = new Map([["input.png", bytes]]), fs = new MemoryFileSystem();
   await fs.writeFile("/input.png", bytes);
   const args = ["input.png", "-precision", precision!, "-define", "connected-components:verbose=true", "-define", "connected-components:major-axis-threshold=0", "-connected-components", "4", "null:"];
   let stdout = "", stderr = "";
   const commandResult = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
   }) : undefined;
   const result = commandResult ? { exitCode: commandResult.exitCode, stdout, stderr } : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
   expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "Objects (id: bounding-box centroid area mean-color major-axis):\n" +
    `  1: 3x2+0+0 1.2,0.6 5 srgb(${channel},0,0) ${axis}\n  0: 1x1+0+0 0.0,0.0 1 srgb(0,0,${channel}) 0\n` });
  });
 }
}
