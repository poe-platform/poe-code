import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI formats gravity from the active scoped option.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { name: "outer gravity", args: ["-gravity", "South", "-respect-parentheses", "(", "-gravity", "East", "xc:red", ")"], expected: "South|South;" },
  { name: "unset outer gravity", args: ["-respect-parentheses", "(", "-gravity", "East", "xc:red", ")"], expected: "|;" },
  { name: "unscoped group", args: ["(", "-gravity", "East", "xc:red", ")"], expected: "East|East;" },
  { name: "disabled scoping", args: ["-gravity", "South", "-respect-parentheses", "+respect-parentheses", "(", "-gravity", "East", "xc:red", ")"], expected: "East|East;" },
  { name: "outer image", args: ["-gravity", "South", "xc:white", "-respect-parentheses", "(", "-gravity", "East", "xc:red", ")"], expected: "South|South;South|South;" },
  { name: "inner output", args: ["-gravity", "South", "-respect-parentheses", "(", "-gravity", "East", "xc:red", "-write", "info:", ")"], expected: "East|East;South|South;" },
  { name: "nested restoration", args: ["-gravity", "South", "-respect-parentheses", "(", "-gravity", "East", "(", "-gravity", "North", "xc:red", ")", "-write", "info:", ")"], expected: "East|East;South|South;" },
  { name: "output after restoration", args: ["-gravity", "South", "-respect-parentheses", "(", "-gravity", "East", "xc:red", ")", "-write", "info:"], expected: "South|South;South|South;" },
])(`${mode}: $name`, async ({ args, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = ["-format", "%[gravity]|%[option:gravity];", ...args, "info:"];
  const argumentValues = createCommandArguments(argv);
  let stdout = "", stderr = "";
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  }) : mode === "sync" ? runMagickCliSync(argv, files)
    : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect("stdout" in result ? result.stdout : stdout).toBe(expected);
  expect("stderr" in result ? result.stderr : stderr).toBe(expected === "|;"
    ? "magick: unknown image property '%[gravity]'\nmagick: unknown image property '%[option:gravity]'\n" : "");
});
