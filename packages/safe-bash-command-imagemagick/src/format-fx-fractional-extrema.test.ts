import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "sync", "buffered", "retained"] as const)("formatted fractional FX extrema (%s)", mode => {
  // Native ImageMagick 7.1.2-35 Q16-HDRI, default six-digit precision.
  it.each([
    {
      name: "distinct fractional extrema",
      inputs: ["xc:#001000100010", "xc:#001100110011", "+append", "-evaluate", "Divide", "7"],
      expected: "2.28571|2.42857|3.48778e-05|3.70576e-05|1"
    },
    {
      name: "integer extrema control",
      inputs: ["xc:#001000100010", "xc:#001100110011", "+append"],
      expected: "16|17|0.000244144|0.000259403|1"
    },
    {
      name: "equal fractional extrema",
      inputs: ["xc:#001000100010", "-evaluate", "Divide", "7"],
      expected: "2.28571|2.28571|3.48778e-05|3.48778e-05|0"
    }
  ])("preserves $name in plain, channel, and image lookups", async ({ inputs, expected }) => {
    const expressions = ["minima", "maxima", "maxima>minima"];
    const format = "%[min]|%[max]|" + expressions.map(expression => `%[fx:${expression}]`).join("|")
      + "|" + ["minima.r", "maxima.r", "u.minima", "u[0].maxima"].map(expression => `%[fx:${expression}]`).join("|");
    const args = [...inputs, "-format", format, "info:"];
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
    const [, , minimum, maximum] = expected.split("|");
    expect("stdout" in result ? result : { ...result, stdout, stderr })
      .toEqual({ exitCode: 0, stdout: [expected, minimum, maximum, minimum, maximum].join("|"), stderr: "" });
  });
});
