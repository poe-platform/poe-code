import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const first = ["(", "-size", "3x2", "xc:#2468ac80", "-repage", "4x3+0+0", ")"];
const second = ["(", "-size", "2x2", "xc:#fc8a2040", "-repage", "4x3+1+1"];
// Full RGBA8 output from ImageMagick 7.1.2-35 Q16-HDRI.
const over = "91b3d5ff91b3d5ff91b3d5ffffffffff91b3d5ffaca9a8ffaca9a8fffffffffffffffffffee2c7fffee2c7ffffffffff";
const multiply = "91b3d5ff91b3d5ff91b3d5ffffffffff91b3d5ff919fa7ff919fa7fffffffffffffffffffee2c7fffee2c7ffffffffff";

for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"]])
it.each([
  { name: "default Over", args: [...first, ...second, ")"], expected: over },
  { name: "direct Multiply", args: [...first, ...second, "-compose", "Multiply", ")"], expected: multiply },
  { name: "option on second layer", args: [...first, ...second, "-set", "option:compose", "Multiply", ")"], expected: multiply },
  { name: "option before flattening", args: [...first, ...second, ")", "-set", "option:compose", "Multiply"], expected: multiply },
  { name: "outer compose override", args: [...first, ...second, "-set", "option:compose", "Multiply", ")", "-compose", "Over"], expected: over },
  { name: "option overrides compose", args: [...first, ...second, ")", "-compose", "Over", "-set", "option:compose", "Multiply"], expected: multiply },
  { name: "removed option retains image setting", args: [...first, ...second, ")", "-set", "option:compose", "Multiply", "+set", "option:compose"], expected: multiply },
  { name: "option before input", args: ["-set", "option:compose", "Multiply", ...first, ...second, ")"], expected: multiply },
])(`${route}: ${operation.join(" ")} uses $name`, async ({ args, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = ["-respect-parentheses", ...args, ...operation, "-depth", "8", "rgba:/out"];
  let stdout = "", stderr = "";
  const result = route === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(argv).args, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
  }) : route === "sync" ? runMagickCliSync(argv, files)
    : await runMagickCli(argv, route === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  expect("stdout" in result ? result.stdout : stdout).toBe("");
  expect("stderr" in result ? result.stderr : stderr).toBe("");
  const bytes = route === "buffered" || route === "sync" ? files.get("/out")! : await fs.readFile("/out");
  expect(Buffer.from(bytes).toString("hex")).toBe(expected);
});
