import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Complete stdout from ImageMagick 7.1.2-35 Q16-HDRI, including channel spacing.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  it.each([
    { name: "opaque LinearGray", input: "xc:#808080", operations: ["-colorspace", "LinearGray"], expected: "LinearGray|lineargray  1.0" },
    { name: "LinearGray with alpha", input: "xc:#80808040", operations: ["-colorspace", "LinearGray"], expected: "LinearGray|lineargraya 2.0" },
    { name: "linear RGB", input: "xc:#808080", operations: ["-colorspace", "RGB"], expected: "RGB|rgb  3.0" },
    { name: "converted back to Gray", input: "xc:#808080", operations: ["-colorspace", "LinearGray", "-colorspace", "Gray"], expected: "Gray|gray  1.0" }
  ])(`${mode}: formats channels for $name`, async ({ input, operations, expected }) => {
    const fs = new MemoryFileSystem();
    const argv = [input, ...operations, "-format", "%[colorspace]|%[channels]", "info:-"];
    let result;
    if (mode === "command") {
      const argumentValues = createCommandArguments(argv);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    } else {
      result = mode === "sync" ? runMagickCliSync(argv, new Map())
        : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    }
    expect(result).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}
