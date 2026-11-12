import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { runIdentifyCli, createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const format = "%[mean]|%[median]|%[standard-deviation]|%[fx:mean]";

// ImageMagick 7.1.2-35 Q16-HDRI, default six-digit precision.
describe.each(["command", "sync", "buffered", "retained"] as const)("gray statistics (%s)", mode => {
  it.each([
    { name: "GrayAlpha", input: ["xc:#40404080", "-colorspace", "Gray"], expected: "24672|24672|0|0.376471" },
    { name: "two-pixel GrayAlpha", input: ["xc:#22222240", "xc:#88888880", "+append", "-colorspace", "Gray"], expected: "23258.5|12593|15083.3|0.354902" },
    { name: "negated GrayAlpha", input: ["xc:#40404080", "-colorspace", "Gray", "-negate"], expected: "40863|40863|0|0.623529" },
    { name: "RGBA control", input: ["xc:#40404080", "-colorspace", "sRGB"], expected: "20560|20560|0|0.313725" },
    { name: "Gray control", input: ["xc:#404040", "-colorspace", "Gray"], expected: "16448|16448|0|0.25098" },
    { name: "gray selection", input: ["xc:#40404080", "-colorspace", "Gray", "-channel", "R"], expected: "16448|16448|0|0.25098" },
    { name: "alpha selection", input: ["xc:#40404080", "-colorspace", "Gray", "-channel", "A"], expected: "32896|32896|0|0.501961" },
    { name: "absent green", input: ["xc:#40404080", "-colorspace", "Gray", "-channel", "G"], expected: "0|0|0|0" },
    { name: "reset selection", input: ["xc:#40404080", "-colorspace", "Gray", "-channel", "A", "+channel"], expected: "24672|24672|0|0.376471" },
    { name: "pixel FX statistics", input: ["xc:#40404080", "-colorspace", "Gray", "-channel", "RGBA", "-fx", "mean"], expected: "12336|12336|0|0.188235" }
  ])("weights physical channels for $name", async ({ input, expected }) => {
    const args = [...input, "-format", format, "info:"];
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
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
});

it.each([false, true])("identifies encoded GrayAlpha (retained=%s)", async retained => {
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  const input = retained ? { filesystem: fs, cwd: "/" } : files;
  expect(await runMagickCli(["xc:#40404080", "-colorspace", "Gray", "/gray.png"], input))
    .toMatchObject({ exitCode: 0, stderr: "" });
  expect(await runIdentifyCli(["-format", format + "|%[fx:mean.g]|%[fx:mean.b]|%[fx:median]", "/gray.png"], input))
    .toEqual({ exitCode: 0, stdout: "24672|24672|0|0.376471|0|0|0.376471", stderr: "" });
});
