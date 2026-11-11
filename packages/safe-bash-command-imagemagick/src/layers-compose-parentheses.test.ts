import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const layers = ["-size", "2x1", "xc:red", "(", "-size", "1x1", "xc:blue", "-repage", "+1+0", "-compose", "Clear", ")"];

// RGBA bytes observed with ImageMagick 7.1.2-35 Q16-HDRI.
for (const route of ["command", "retained", "buffered", "sync"] as const)
for (const operation of [["-flatten"], ["-layers", "flatten"], ["-layers", "merge"], ["-mosaic"], ["-layers", "mosaic"]])
it.each([
  { name: "unscoped group setting", args: layers, expected: "0000000000000000" },
  { name: "scoped per-frame settings", args: ["-respect-parentheses", ...layers], expected: "ff0000ff00000000" },
  { name: "repeated outer setting", args: [...layers, "-compose", "Clear"], expected: "0000000000000000" },
  { name: "outer override", args: [...layers, "-compose", "Over"], expected: "ff0000ff0000ffff" },
  { name: "reset after group", args: [...layers, "+compose"], expected: "ff0000ff0000ffff" },
  { name: "nested unscoped groups", args: ["(", ...layers, ")"], expected: "0000000000000000" },
  { name: "nested scoped groups", args: ["-respect-parentheses", "(", ...layers, ")"], expected: "ff0000ff00000000" },
  { name: "restored explicit outer setting", args: ["-respect-parentheses", "-compose", "Over", ...layers], expected: "ff0000ff0000ffff" },
])(`${route}: ${operation.join(" ")} uses $name`, async ({ args, expected }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const argv = [...args, ...operation, "-depth", "8", "rgba:/out"];
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
