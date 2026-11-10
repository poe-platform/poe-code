import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const grouped = ["(", "-compose", "Multiply", "xc:red", ")", "(", "-compose", "Screen", "xc:blue", ")"];

// Observed with ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each([
  { name: "last setting across groups", args: grouped, expected: "Screen;Screen;" },
  { name: "scoped settings", args: ["-respect-parentheses", ...grouped], expected: "Multiply;Screen;" },
  { name: "ungrouped settings", args: ["-compose", "Multiply", "xc:red", "-compose", "Screen", "xc:blue"], expected: "Screen;Screen;" },
  { name: "nested groups", args: ["(", ...grouped, ")"], expected: "Screen;Screen;" },
  { name: "deleted final image", args: [...grouped, "-delete", "1"], expected: "Screen;" },
  { name: "explicit outer setting", args: ["-respect-parentheses", "-compose", "Over", ...grouped], expected: "Over;Over;" },
])(`${mode}: $name`, async ({ args, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = [...args, "-format", "%[compose];", "info:/out"];
  let stdout = "", stderr = "";
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(argv).args, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  }) : mode === "sync" ? runMagickCliSync(argv, files)
    : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect("stdout" in result ? result.stdout : stdout).toBe("");
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
  expect(new TextDecoder().decode(bytes)).toBe(expected);
});
