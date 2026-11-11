import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { name: "changed precision with scoped settings", args: ["-respect-parentheses", "(", "xc:blue", "-precision", "9", ")", "-delete", "1"], expected: "0.333333333" },
    { name: "changed precision without scoped settings", args: ["(", "xc:blue", "-precision", "9", ")", "-delete", "1"], expected: "0.333333333" },
    { name: "unchanged precision with scoped settings", args: ["-respect-parentheses", "(", "xc:blue", ")", "-delete", "1"], expected: "0.33" },
    { name: "child image uses the same precision", args: ["-respect-parentheses", "(", "xc:blue", "-precision", "9", ")", "-delete", "0"], expected: "0.333333333" },
    { name: "nested precision survives both groups", args: ["-respect-parentheses", "(", "-precision", "4", "(", "xc:blue", "-precision", "9", ")", ")", "-delete", "1"], expected: "0.333333333" },
    { name: "later precision overrides grouped precision", args: ["-respect-parentheses", "(", "xc:blue", "-precision", "9", ")", "-delete", "1", "-precision", "3"], expected: "0.333" },
    { name: "format still restores after the group", args: ["-respect-parentheses", "(", "xc:blue", "-precision", "9", "-format", "%w", ")", "-delete", "1"], expected: "0.333333333" },
    { name: "size still restores after the group", args: ["-size", "3x1", "-respect-parentheses", "(", "-size", "2x1", "xc:blue", "-precision", "9", ")", "-delete", "0,1", "xc:red", "-format", "%w|%[fx:1/3]"], expected: "3|0.333333333" }
  ])(`${mode}: $name`, async ({ args, expected }) => {
    const fs = new MemoryFileSystem();
    const argv = ["xc:red", "-precision", "2", "-format", "%[fx:1/3]", ...args, "info:"];
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
