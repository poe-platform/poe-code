import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const type of ["Grayscale", "Bilevel"] as const) {
  const grouped = ["xc:red", "(", "xc:blue", "-type", type, ")"];
  const blue = type === "Grayscale" ? [18, 18, 18, 255] : [0, 0, 0, 255];
  for (const mode of ["command", "retained", "buffered", "sync"] as const)
  for (const output of ["info", "rgba"] as const)
  it.each([
    { name: "unscoped setting", args: grouped, types: [type, type] },
    { name: "scoped setting", args: ["-respect-parentheses", ...grouped], types: ["Palette", type] },
    { name: "nested groups", args: ["xc:red", "(", "(", "xc:blue", "-type", type, ")", ")"], types: [type, type] },
    { name: "deleted later frame", args: [...grouped, "-delete", "1"], types: [type] },
    { name: "scoped deleted frame", args: ["-respect-parentheses", ...grouped, "-delete", "1"], types: ["Palette"] },
    { name: "restored outer type", args: ["-respect-parentheses", "-type", "TrueColor", ...grouped], types: ["Palette", type] },
  ])(`${mode} ${output} ${type}: $name`, async ({ args, types }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = [...args, ...(output === "info"
      ? ["-format", "%[type];", "info:/out"] : ["-depth", "8", "rgba:/out"])];
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
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    const bytes = mode === "buffered" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    if (output === "info") expect(new TextDecoder().decode(bytes)).toBe(`${types.join(";")};`);
    else expect([...bytes]).toEqual([255, 0, 0, 255, ...(types.length === 2 ? blue : [])]);
  });
}
