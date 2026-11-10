import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "retained", "buffered", "sync"] as const)("function coefficient commas (%s)", mode => {
  it.each([
    { coefficients: "0.5,0,", exitCode: 0, expected: "10203040" },
    { coefficients: "0.5,0", exitCode: 0, expected: "10203040" },
    { coefficients: "0.5,,0", exitCode: 1, expected: "" },
    { coefficients: "0.5,0,,", exitCode: 1, expected: "" }
  ])("handles $coefficients", async ({ coefficients, exitCode, expected }) => {
    const argv = ["xc:#20406080", "-function", "Polynomial", coefficients, "-depth", "8", "rgba:-"];
    const fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    const error = "stderr" in result ? result.stderr : stderr;
    expect(result.exitCode, error).toBe(exitCode);
    if (exitCode === 0) expect(error).toBe("");
    else expect(error).toContain("invalid list of numbers '-function'");
    const bytes = mode === "command" ? Buffer.concat(chunks)
      : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
      : Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
    expect(bytes.toString("hex")).toBe(expected);
  });
});
