import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { name: "image property", args: ["-set", "interlace", "Line"], expected: "Line;" },
  { name: "CLI setting", args: ["-interlace", "Line"], expected: "Line;" },
  { name: "default", args: [], expected: "None;" },
  { name: "case-insensitive key and literal value", args: ["-set", "INTERLACE", "lInE"], expected: "lInE;" },
  { name: "arbitrary text", args: ["-set", "interlace", "custom"], expected: "custom;" },
  { name: "empty text", args: ["-set", "interlace", ""], expected: ";" },
  { name: "removed property", args: ["-set", "interlace", "Line", "+set", "interlace"], expected: "None;" },
  { name: "earlier CLI setting", args: ["-interlace", "Plane", "-set", "interlace", "Line"], expected: "Line;" },
  { name: "later CLI setting", args: ["-set", "interlace", "Line", "-interlace", "Plane"], expected: "Line;" },
  { name: "removed property exposes CLI setting", args: ["-interlace", "Plane", "-set", "interlace", "Line", "+set", "interlace"], expected: "Plane;" },
  { name: "per-image property", args: ["-set", "interlace", "Line", "xc:blue"], expected: "Line;None;" },
  { name: "property expansion", args: ["-set", "label", "Line", "-set", "interlace", "%[label]"], expected: "Line;" },
])(`${mode}: reports interlace from $name`, async ({ args, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = ["xc:red", ...args, "-format", "%[interlace];", "info:-"];
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
