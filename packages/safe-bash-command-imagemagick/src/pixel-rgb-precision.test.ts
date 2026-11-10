import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7 Q16-HDRI prints fractional RGB channels as percentages.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { options: [], format: "%[pixel:p{0,0}]", expected: "srgb(21.2656%,71.5158%,7.2186%)" },
    { options: ["-depth", "16"], format: "%[pixel:p{0,0}]", expected: "srgb(21.2656%,71.5158%,7.2186%)" },
    { options: ["-precision", "4"], format: "%[pixel:p{0,0}]", expected: "srgb(21.27%,71.52%,7.219%)" },
    { options: ["-alpha", "on"], format: "%[pixel:p{0,0}]", expected: "srgba(21.2656%,71.5158%,7.2186%,1)" },
    { options: [], format: "%[hex:p{0,0}]", expected: "3670B714127B" },
    { options: [], format: "%[fx:u.r],%[fx:u.g],%[fx:u.b]", expected: "0.212656,0.715158,0.072186" },
    { options: [], format: "%[pixel:1]", expected: "srgb(255,255,255)" }
  ])(`${mode}: preserves RGB precision with $options $format`, async ({ options, format, expected }) => {
    const args = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "-combine", ...options, "-format", format, "info:"];
    const fs = new MemoryFileSystem();
    let result;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    } else {
      result = mode === "sync" ? runMagickCliSync(args, new Map())
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    }
    expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}
