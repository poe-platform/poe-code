import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "sync", "buffered", "retained"] as const)("fractional distribution properties (%s)", mode => {
  // ImageMagick 7.1.2-35 Q16-HDRI: scaling preserves these distribution moments.
  it.each([
    { divisor: "1", samples: [16, 17], expected: "0|-2.75", mean: "16.5", deviation: "0.707107" },
    { divisor: "2", samples: [16, 17], expected: "0|-2.75", mean: "8.25", deviation: "0.353553" },
    { divisor: "7", samples: [16, 17], expected: "0|-2.75", mean: "2.35714", deviation: "0.101015" },
    { divisor: "7", samples: [16, 16, 17], expected: "0.3849|-2.33333", mean: "2.33333", deviation: "0.0824786" },
    { divisor: "7", samples: [16, 16], expected: "0|0", mean: "2.28571", deviation: "0" }
  ])("uses working samples for $samples divided by $divisor", async ({ divisor, samples, expected, mean, deviation }) => {
    const format = "%[skewness]|%[kurtosis]|%[fx:skewness]|%[fx:kurtosis]"
      + "|%[fx:skewness.r]|%[fx:kurtosis.r]|%[fx:u.skewness]|%[fx:u[0].kurtosis]"
      + "|%[mean]|%[standard-deviation]";
    const args = [...samples.map(sample => `xc:#${sample.toString(16).padStart(4, "0").repeat(3)}`),
      "+append", "-evaluate", "Divide", divisor, "-format", format, "info:"];
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
      .toEqual({ exitCode: 0, stdout: [expected, expected, expected, expected, mean, deviation].join("|"), stderr: "" });
  });
});
