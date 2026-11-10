import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "sync", "buffered", "retained"] as const)("formatted working-sample means (%s)", mode => {
  // Native ImageMagick 7.1.2-35 Q16-HDRI reference values for a single #804020 pixel.
  it.each([
    { colorspace: "HSL", channel: "R", expected: "0.0555556" },
    { colorspace: "Lab", channel: "R", expected: "0.347213" },
    { colorspace: "XYZ", channel: "R", expected: "0.10996" },
    { colorspace: "HSL", channel: "G", expected: "0.6" },
    { colorspace: "sRGB", channel: "R", expected: "0.501961" }
  ])("keeps $colorspace $channel conversion precision", async ({ colorspace, channel, expected }) => {
    const args = ["xc:#804020", "-colorspace", colorspace, "-channel", channel, "-format", "%[fx:mean]", "info:-"];
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
