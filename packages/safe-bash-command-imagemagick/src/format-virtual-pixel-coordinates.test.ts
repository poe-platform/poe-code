import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCliSync } from "./index.js";

it.each(["sync", "command"])("honors virtual pixels in formatted coordinates through %s", async route => {
  for (const [method, format, expected] of [
    ["black", "%[pixel:p{0,-1}]", "srgb(0,0,0)"],
    ["tile", "%[hex:p{0,-1}]", "00000000FFFF"],
    ["transparent", "%[fx:p{0,-1}.r]", "0"],
    ["transparent", "%[fx:p{0,-1}.a]", "0"],
    ["edge", "%[pixel:p{0,-1}]", "srgb(255,0,0)"],
    ["white", "%[pixel:p{3,3}]", "srgb(255,255,255)"],
    ["tile", "%[hex:p{3,3}]", "FFFF00000000"],
    ["black", "%[pixel:p{0,0}]", "srgb(255,0,0)"]
  ]) {
    const argv = ["-size", "3x3", "gradient:red-blue", "-virtual-pixel", method!, "-format", format!, "info:"];
    let result;
    if (route === "sync") result = runMagickCliSync(argv, new Map());
    else {
      const argumentValues = createCommandArguments(argv);
      let stdout = "", stderr = "";
      const execution = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues,
        fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
        stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...execution, stdout, stderr };
    }
    expect(result, `${method}: ${format}`).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
  }
});
