import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "sync", "buffered", "retained"] as const)("formatted FX mean (%s)", mode => {
  it.each([
    { options: ["-channel", "R"], expression: "mean", expected: "0.188235;" },
    { options: ["-channel", "B"], expression: "mean", expected: "0.313725;" },
    { options: [], expression: "mean", expected: "0.329412;" },
    { options: ["-channel", "R"], expression: "mean.r", expected: "0.188235;" },
    { options: ["-channel", "B", "+channel"], expression: "mean", expected: "0.329412;" },
  ])("formats $expression with $options", async ({ options, expression, expected }) => {
    // ImageMagick 7.1.2-35 Q16-HDRI reference values.
    const args = ["-size", "3x2", "xc:#30905040", ...options, "-format", `%[fx:${expression}];`, "info:out"];
    const initial = new TextEncoder().encode("KEEP");
    const files = new Map([["out", initial]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out", initial);
    let stdout = "", stderr = "";
    const argumentValues = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stdout" in result ? result : { ...result, stdout, stderr })
      .toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out") : files.get("out");
    expect(new TextDecoder().decode(output)).toBe(expected);
  });
});
