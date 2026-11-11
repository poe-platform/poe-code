import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 records lowercase none for +gravity, preserving explicit None.
describe.each(["command", "retained", "buffered", "sync"] as const)("gravity reset properties (%s)", mode => {
  it.each([
    { options: ["+gravity"], expected: "none" },
    { options: ["-gravity", "East", "+gravity"], expected: "none" },
    { options: ["-gravity", "None"], expected: "None" },
    { options: ["+gravity", "-gravity", "West"], expected: "West" },
    { options: ["+gravity"], expected: "none", beforeInput: true },
    { options: ["-gravity", "East", "+gravity"], expected: "none", beforeInput: true },
    { options: [], expected: "", missing: true }
  ])("formats $options (before input: $beforeInput)", async ({ options, expected, beforeInput = false, missing = false }) => {
    const argv = [...(beforeInput ? [...options, "xc:red"] : ["xc:red", ...options]), "-format", "%[gravity]|%[option:gravity]", "info:"];
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
      exitCode: 0, stdout: `${expected}|${expected}`,
      stderr: missing ? "magick: unknown image property '%[gravity]'\nmagick: unknown image property '%[option:gravity]'\n" : ""
    });
  });
});
