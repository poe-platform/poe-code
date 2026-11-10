import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const density = ["(", "-density", "100", "xc:red", ")", "(", "-density", "200", "xc:blue", ")"];
const units = ["(", "-units", "PixelsPerInch", "xc:red", ")", "(", "-units", "PixelsPerCentimeter", "xc:blue", ")"];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { name: "group density", args: density, format: "%x,%y,%U;", expected: "200,200,Undefined;200,200,Undefined;" },
  { name: "reversed density", args: [...density, "-reverse"], format: "%x,%y,%U;", expected: "200,200,Undefined;200,200,Undefined;" },
  { name: "group units", args: units, format: "%U;", expected: "PixelsPerCentimeter;PixelsPerCentimeter;" },
  { name: "scoped density", args: ["-respect-parentheses", ...density], format: "%x,%y,%U;", expected: "100,100,Undefined;200,200,Undefined;" },
  { name: "ungrouped density", args: ["-density", "100", "xc:red", "-density", "200", "xc:blue"], format: "%x,%y,%U;", expected: "200,200,Undefined;200,200,Undefined;" },
  { name: "scoped units", args: ["-respect-parentheses", ...units], format: "%U;", expected: "PixelsPerInch;PixelsPerCentimeter;" },
])(`${mode}: $name`, async ({ args, format, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = [...args, "-format", format, "info:-"];
  let stdout = "", stderr = "";
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(argv).args, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  }) : mode === "sync" ? runMagickCliSync(argv, files)
    : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  expect("stdout" in result ? result.stdout : stdout).toBe(expected);
});
