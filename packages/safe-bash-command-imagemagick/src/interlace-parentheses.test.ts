import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const grouped = ["(", "-interlace", "plane", "xc:red", ")", "(", "-interlace", "line", "xc:blue", ")"];

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { name: "last setting across groups", args: grouped, expected: "Line;Line;" },
  { name: "scoped settings", args: ["-respect-parentheses", ...grouped], expected: "Plane;Line;" },
  { name: "ungrouped settings", args: ["-interlace", "plane", "xc:red", "-interlace", "line", "xc:blue"], expected: "Line;Line;" },
  { name: "nested groups", args: ["(", ...grouped, ")"], expected: "Line;Line;" },
  { name: "deleted last frame", args: [...grouped, "-delete", "1"], expected: "Line;" },
  { name: "scoped deleted frame", args: ["-respect-parentheses", ...grouped, "-delete", "1"], expected: "Plane;" },
])(`${mode}: $name`, async ({ args, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = [...args, "-format", "%[interlace];", "info:-"];
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
