import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "sync", "buffered", "retained"] as const)("formatted working-sample intensity (%s)", mode => {
  // Native ImageMagick 7.1.2-35 Q16-HDRI at the default six-digit precision.
  it.each([
    { colorspace: "HSL", expected: "0.494056" },
    { colorspace: "Lab", expected: "0.624664" },
    { colorspace: "sRGB", expected: "0.42245" }
  ])("retains fractional $colorspace samples for direct and coordinate lookups", async ({ colorspace, expected }) => {
    const expressions = ["intensity", "p{0,0}.intensity", "u.intensity", "u[0].p{0,0}.intensity"];
    const args = ["xc:#a653b580", "-colorspace", colorspace, "-format", expressions.map(expression => `%[fx:${expression}]`).join("|"), "info:"];
    const fs = new MemoryFileSystem();
    const argumentValues = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, new Map())
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect("stdout" in result ? result : { ...result, stdout, stderr })
      .toEqual({ exitCode: 0, stdout: expressions.map(() => expected).join("|"), stderr: "" });
  });
});
