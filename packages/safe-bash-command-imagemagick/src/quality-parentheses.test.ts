import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const groups = ["(", "-quality", "30", "xc:red", ")", "(", "-quality", "70", "xc:blue", ")"];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { name: "scoped quality", args: ["-respect-parentheses", ...groups], expected: "30;70;" },
  { name: "unscoped quality", args: groups, expected: "70;70;" },
  { name: "ungrouped quality", args: ["-quality", "30", "xc:red", "-quality", "70", "xc:blue"], expected: "70;70;" },
  { name: "reversed scoped quality", args: ["-respect-parentheses", ...groups, "-reverse"], expected: "70;30;" },
  { name: "outer quality override", args: ["-respect-parentheses", ...groups, "-quality", "80"], expected: "80;80;" },
])(`${mode}: $name`, async ({ args, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = [...args, "-format", "%Q;", "info:-"];
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
