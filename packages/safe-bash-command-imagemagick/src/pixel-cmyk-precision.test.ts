import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7 Q16-HDRI uses significant digits for CMYK inks and alpha.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { precision: [], color: "#abcdef", expected: "cmyk(72.5523,36.2762,0,16)" },
    { precision: ["-precision", "3"], color: "#abcdef", expected: "cmyk(72.6,36.3,0,16)" },
    { precision: ["-precision", "9"], color: "#abcdef", expected: "cmyk(72.5523012,36.2761506,0,16)" },
    { precision: [], color: "#abcdef80", expected: "cmyka(72.5523,36.2762,0,16,0.501961)" },
    { precision: ["-precision", "3"], color: "#abcdef80", expected: "cmyka(72.6,36.3,0,16,0.502)" },
    { precision: ["-precision", "9"], color: "#abcdef80", expected: "cmyka(72.5523012,36.2761506,0,16,0.501960784)" },
    { precision: ["-precision", "3"], color: "red", expected: "cmyk(0,255,255,0)" },
    { precision: ["-precision", "9"], color: "red", expected: "cmyk(0,255,255,0)" }
  ])(`${mode}: formats CMYK $color with $precision`, async ({ precision, color, expected }) => {
    const args = [`xc:${color}`, "-colorspace", "CMYK", ...precision, "-format", "%[pixel:p{0,0}]", "info:"];
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
