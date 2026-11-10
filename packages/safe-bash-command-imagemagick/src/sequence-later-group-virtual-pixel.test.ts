import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const) {
  // Native ImageMagick 7.1.2-35 Q16-HDRI, complete row-major RGBA8 output.
  it.each([
    { operation: "mean", flags: [], grouped: true, expected: "1917274811060e26" },
    { operation: "median", flags: [], grouped: true, expected: "11223344210b1b4b" },
    { operation: "max", flags: [], grouped: true, expected: "2122334b210b1b4b" },
    { operation: "mean", flags: ["-respect-parentheses"], grouped: true, expected: "1917274819172748" },
    { operation: "mean", flags: [], grouped: false, expected: "1917274819172748" },
  ])(`${mode}: $operation with a later group (scoping $flags, grouped=$grouped)`, async ({ operation, flags, grouped, expected }) => {
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    const argv = [...flags, "-size", "1x1", "xc:#11223344", ...(grouped ? ["("] : []),
      "-size", "1x2", "xc:#210b1b4b", ...(grouped ? ["-virtual-pixel", "transparent", ")"] : []),
      "-evaluate-sequence", operation, "+channel", "-depth", "8", "rgba:-"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const args = createCommandArguments(argv);
    const result = mode === "command"
      ? await createMagickCommand().execute({ command: "magick", args: args.args, argumentValues: args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(chunk) { chunks.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } })
      : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" ? Buffer.concat(chunks)
      : Buffer.from("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : []);
    expect(output.toString("hex")).toBe(expected);
  });
}
