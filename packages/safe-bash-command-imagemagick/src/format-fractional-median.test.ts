import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "sync", "buffered", "retained"] as const)("formatted fractional medians (%s)", mode => {
  // Native ImageMagick 7.1.2-35 Q16-HDRI, default six-digit precision.
  it.each([
    {
      name: "single fractional pixel",
      inputs: ["xc:#001000100010", "-evaluate", "Divide", "7"],
      expected: "2.28571|3.48778e-05|2.28571"
    },
    {
      name: "lower fractional median",
      inputs: ["xc:#001000100010", "xc:#001100110011", "+append", "-evaluate", "Divide", "7"],
      expected: "2.28571|3.48778e-05|2.35714"
    },
    {
      name: "unsorted odd-sized fractional median",
      inputs: ["xc:#001100110011", "xc:#001300130013", "xc:#001000100010", "+append", "-evaluate", "Divide", "7"],
      expected: "2.42857|3.70576e-05|2.47619"
    },
    {
      name: "negative lower median",
      inputs: ["xc:#001000100010", "xc:#001100110011", "+append", "-evaluate", "Divide", "-7"],
      expected: "-2.42857|-3.70576e-05|-2.35714"
    },
    {
      name: "above-range lower median",
      inputs: ["xc:#001000100010", "xc:#001100110011", "+append", "-evaluate", "Multiply", "5000"],
      expected: "80000|1.22072|82500"
    },
    {
      name: "fractional median across storage chunks",
      inputs: ["-size", "513x1", "xc:#001000100010", "xc:#001100110011", "+append", "-evaluate", "Divide", "7"],
      expected: "2.28571|3.48778e-05|2.35714"
    },
    {
      name: "read-mask-selected fractional median",
      inputs: ["(", "xc:black", "xc:white", "+append", "-write", "mpr:mask", "+delete", ")",
        "xc:#001000100010", "xc:#001100110011", "+append", "-evaluate", "Divide", "7", "-read-mask", "mpr:mask"],
      expected: "2.42857|3.70576e-05|2.42857"
    },
    {
      name: "integer control",
      inputs: ["xc:#001000100010", "xc:#001100110011", "+append"],
      expected: "16|0.000244144|16.5"
    }
  ])("preserves $name in plain, channel, and image lookups", async ({ inputs, expected }) => {
    const format = "%[median]|%[fx:median]|%[mean]|%[fx:median.r]|%[fx:u.median]|%[fx:u[0].median]";
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
    const median = expected.split("|")[1];
    expect("stdout" in result ? result : { ...result, stdout, stderr })
      .toEqual({ exitCode: 0, stdout: [expected, median, median, median].join("|"), stderr: "" });
  });
});
