import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick preserves explicit spelling; +endian records lowercase undefined.
describe.each(["command", "retained", "buffered", "sync"] as const)("endian properties (%s)", mode => {
  it.each([
    { options: ["-endian", "MSB"], expected: "MSB" },
    { options: ["-endian", "LSB"], expected: "LSB" },
    { options: ["-endian", "Undefined"], expected: "Undefined" },
    { options: ["-endian", "mSb"], expected: "mSb" },
    { options: ["+endian"], expected: "undefined" },
    { options: ["-endian", "LSB", "+endian"], expected: "undefined" },
    { options: ["+endian", "-endian", "MSB"], expected: "MSB" },
    { options: ["-endian", "MSB"], expected: "MSB", beforeInput: true },
    { options: ["-endian", "LSB", "+endian"], expected: "undefined", beforeInput: true },
    { options: [], expected: "", missing: true },
    { options: ["-set", "option:endian", "LSB"], expected: "LSB" },
    { options: ["-set", "option:endian", "LSB", "-endian", "MSB"], expected: "MSB" },
    { options: ["-endian", "MSB", "-set", "option:endian", "LSB"], expected: "LSB" },
    { options: ["-endian", "MSB", "+set", "option:endian"], expected: "", missing: true }
  ])("formats $options (before input: $beforeInput)", async ({ options, expected, beforeInput = false, missing = false }) => {
    const input = ["xc:#123456789abc", "-depth", "16"];
    const argv = [...(beforeInput ? [...options, ...input] : [...input, ...options]), "-format", "%[endian]/%[option:endian]", "info:-"];
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect({ stdout, stderr, ...result }).toEqual({
      exitCode: 0, stdout: `${expected}/${expected}`,
      stderr: missing ? "magick: unknown image property '%[endian]'\nmagick: unknown image property '%[option:endian]'\n" : ""
    });
  });
});
