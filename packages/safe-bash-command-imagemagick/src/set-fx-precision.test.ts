import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "retained", "buffered", "sync"] as const)("-set FX precision (%s)", mode => {
  it.each(["comment", "label", "memo", "filename:memo", "option:memo"].flatMap(property => [
    { property, precision: "2", laterPrecision: "8", stored: "0.33", fresh: "0.33333333" },
    { property, precision: "8", laterPrecision: "2", stored: "0.33333333", fresh: "0.33" },
    { property, precision: "0", laterPrecision: "8", stored: "0.333333", fresh: "0.33333333" }
  ]))("captures $property at precision $precision before switching to $laterPrecision", async ({ property, precision, laterPrecision, stored, fresh }) => {
    const argv = ["xc:red", "-precision", precision, "-print", "%[fx:1/3]|",
      "-set", property, "%[fx:1/3]", "-precision", laterPrecision,
      "-set", "saved", `%[${property}]`, "-set", "fresh", "%[fx:1/3]",
      "-format", `%[${property}]|%[saved]|%[fresh]|%[fx:1/3]`, "info:"];
    const fs = new MemoryFileSystem();
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect({ stdout, stderr, ...result }).toEqual({
      exitCode: 0, stdout: `${stored}|${stored}|${stored}|${fresh}|${fresh}`, stderr: ""
    });
  });
});
