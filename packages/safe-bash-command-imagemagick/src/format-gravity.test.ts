import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const inputs = ["-size", "2x3", "xc:#8040c080", "-size", "3x2", "xc:#30905040"];

// Native ImageMagick 7.1.2-35 Q16-HDRI output for the two-frame reproductions.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: [...inputs, "-gravity", "East"], expected: "East;East;" },
    { args: [...inputs, "-gravity", "East", "-append"], expected: "East;" },
    { args: [...inputs, "-gravity", "East", "+append"], expected: "East;" },
    { args: inputs, expected: ";;" },
    { args: [...inputs, "-append"], expected: ";" },
    { args: ["-gravity", "east", ...inputs], expected: "East;East;" },
    { args: [...inputs, "-gravity", "East", "+gravity"], expected: "none;none;" },
    { args: [...inputs, "-gravity", "East", "+gravity", "-append"], expected: "none;" },
    { args: [...inputs, "-gravity", "East", "-gravity", "SouthWest"], expected: "SouthWest;SouthWest;" },
    { args: ["-respect-parentheses", "(", "xc:red", "-gravity", "NorthEast", ")", "xc:blue"], expected: "NorthEast;;" },
    { args: ["-respect-parentheses", "(", "xc:red", "-gravity", "NorthEast", ")", "xc:blue", "-append"], expected: "NorthEast;" }
  ])(`formats per-image gravity (${mode}): $args`, async ({ args, expected }) => {
    const fs = new MemoryFileSystem();
    const keep = new TextEncoder().encode("KEEP");
    await fs.writeFile("/out", keep);
    const files = new Map([["out", keep]]);
    const argv = [...args, "-format", "%[gravity];", "info:out"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe("");
    expect("stderr" in result ? result.stderr : stderr).toBe(
      expected.includes(";;") || expected === ";" ? "magick: unknown image property '%[gravity]'\n" : ""
    );
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out")!;
    expect(new TextDecoder().decode(output)).toBe(expected);
  });
}
