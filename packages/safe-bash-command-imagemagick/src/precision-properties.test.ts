import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: ["xc:red", "-set", "digits", "4", "-precision", "%[digits]"], expected: "0.3333|0.1111" },
    { args: ["xc:red", "-define", "pr=3", "-precision", "%[option:pr]"], expected: "0.333|0.111" },
    { args: ["xc:red", "-precision", "%[fx:w+2]"], expected: "0.333|0.111" },
    { args: ["-define", "pr=3", "-precision", "%[option:pr]", "xc:red"], expected: "0.333|0.111" },
    { args: ["xc:red", "xc:blue", "-precision", "%[fx:n+1]"], expected: "0.333|0.1110.333|0.111" },
    { args: ["xc:red", "-set", "digits", "0", "-precision", "%[digits]"], expected: "0.333333|0.111111" },
    { args: ["xc:red", "-precision", "3"], expected: "0.333|0.111" },
    { args: ["xc:red", "-set", "digits", "invalid", "-precision", "%[digits]"], expected: "", exitCode: 1 },
    { args: ["xc:red", "-define", "pr=invalid", "-precision", "%[option:pr]"], expected: "", exitCode: 1 }
  ])(`expands precision before validation (${mode}): $args`, async ({ args, expected, exitCode = 0 }) => {
    const fs = new MemoryFileSystem();
    const argv = [...args, "-format", "%[fx:1/3]|%[fx:1/9]", "info:-"];
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
      .toEqual({ exitCode, stdout: expected, stderr: exitCode ? "magick: invalid argument for option '-precision'\n" : "" });
  });
}
