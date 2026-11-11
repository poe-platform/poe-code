import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7 Q16-HDRI uses significant digits for sRGBA alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { precision: [], color: "#d0502801", alpha: "0.00392157" },
    { precision: ["-precision", "8"], color: "#d0502801", alpha: "0.0039215686" },
    { precision: ["-precision", "8"], color: "#d0502880", alpha: "0.50196078" },
    { precision: [], color: "#d0502880", alpha: "0.501961" },
    { precision: ["-precision", "3"], color: "#d0502880", alpha: "0.502" },
    { precision: ["-precision", "8"], color: "#d05028ff", alpha: "1" }
  ])(`${mode}: formats sRGBA $color with $precision`, async ({ precision, color, alpha }) => {
    const args = [`xc:${color}`, ...precision, "-format", "%[pixel:p{0,0}]|%[fx:p{0,0}.a]", "info:"];
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
    expect(result).toEqual({ exitCode: 0, stdout: `srgba(208,80,40,${alpha})|${alpha}`, stderr: "" });
  });
}
