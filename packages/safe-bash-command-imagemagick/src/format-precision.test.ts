import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: ["xc:red", "-precision", "3"], expected: "0.333|0.111" },
    { args: ["-precision", "3", "xc:red"], expected: "0.333|0.111" },
    { args: ["xc:red", "-precision", "12"], expected: "0.333333333333|0.111111111111" },
    { args: ["-precision", "12", "xc:red"], expected: "0.333333333333|0.111111111111" },
    { args: ["xc:red"], expected: "0.333333|0.111111" },
    { args: ["xc:red", "-precision", "6"], expected: "0.333333|0.111111" },
    { args: ["xc:red", "-precision", "0"], expected: "0.333333|0.111111" },
    { args: ["xc:red", "-precision", "-1"], expected: "0.333333|0.111111" },
    { args: ["xc:red", "-precision", "9"], expected: "0.333333333|0.111111111" },
    { args: ["xc:red", "-precision", "9", "-precision", "0"], expected: "0.333333333|0.111111111" },
    { args: ["xc:red", "-precision", "9", "+precision"], expected: "0.333333|0.111111" },
    { args: ["xc:red", "-precision", "9", "-precision", "-1"], expected: "0.333333|0.111111" },
    { args: ["-precision", "9", "-precision", "0", "xc:red"], expected: "0.333333333|0.111111111" },
    { args: ["-precision", "9", "+precision", "xc:red"], expected: "0.333333|0.111111" },
    { args: ["xc:red", "-precision", "12", "-precision", "3"], expected: "0.333|0.111" },
    { args: ["xc:#804020", "-precision", "3"], format: "%[fx:mean.r]|%[mean]", expected: "0.502|1.92e+04" }
  ])(`honors INFO format precision (${mode}): $args`, async ({ args, format, expected }) => {
    const fs = new MemoryFileSystem();
    const argv = [...args, "-format", format ?? "%[fx:1/3]|%[fx:1/9]", "info:-"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}
