import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "sync", "buffered", "retained"] as const)("CMYK FX mean (%s)", mode => {
  it.each([
    { color: "#804020", space: "CMYK", options: ["-channel", "C"], expected: "0" },
    { color: "#804020", space: "CMYK", options: ["-channel", "M"], expected: "0.5" },
    { color: "#804020", space: "CMYK", options: ["-channel", "Y"], expected: "0.75" },
    { color: "#804020", space: "CMYK", options: ["-channel", "K"], expected: "0.498039" },
    { color: "#804020", space: "CMYK", options: [], expected: "0.43701" },
    { color: "#555555", space: "CMYK", options: ["-channel", "K"], expected: "0.666667" },
    { color: "#804020", space: "sRGB", options: ["-channel", "C"], expected: "0.501961" },
    { color: "#804020", space: "sRGB", options: [], expected: "0.29281" },
    { color: "#80402080", space: "CMYK", options: ["-channel", "K"], expected: "0.498039" },
    { color: "#80402080", space: "CMYK", options: ["-channel", "A"], expected: "0.501961" },
    { color: "#80402080", space: "CMYK", options: [], expected: "0.45" },
    { color: "#804020", space: "CMYK", options: [], expression: "mean.k", expected: "0.498039" },
    { color: "#804020", space: "CMYK", options: ["-channel", "K", "+channel"], expected: "0.43701" },
  ])("$color in $space with $options", async ({ color, space, options, expression = "mean", expected }) => {
    // ImageMagick 7.1.2-35 Q16-HDRI reference output.
    const args = [`xc:${color}`, "-colorspace", space, ...options, "-format", `%[fx:${expression}]`, "info:-"];
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const argumentValues = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect("stdout" in result ? result : { ...result, stdout, stderr })
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
});
