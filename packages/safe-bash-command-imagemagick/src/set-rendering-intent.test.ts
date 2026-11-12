import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: ["-set", "rendering-intent", "Relative"], expected: "||", missing: ["rendering-intent", "intent", "demo"] },
    { args: ["-set", "rendering-intent", "Saturation"], expected: "||", missing: ["rendering-intent", "intent", "demo"] },
    { args: ["-set", "PROPERTY:Rendering-Intent", "Relative"], expected: "||", missing: ["rendering-intent", "intent", "demo"] },
    { args: ["-intent", "Saturation"], expected: "|Saturation|", missing: ["rendering-intent", "demo"] },
    { args: ["-intent", "Saturation", "-set", "rendering-intent", "Relative"], expected: "|Saturation|", missing: ["rendering-intent", "demo"] },
    { args: ["-set", "demo", "Saturation"], expected: "||Saturation", missing: ["rendering-intent", "intent"] }
  ])(`keeps rendering-intent out of string properties (${mode}): $args`, async ({ args, expected, missing }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    const argv = ["xc:red", ...args, "-format", "%[rendering-intent]|%[intent]|%[demo]", "info:"];
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(argv).args, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    expect("stderr" in result ? result.stderr : stderr).toBe(
      missing.map(key => `magick: unknown image property '%[${key}]'\n`).join("")
    );
  });
}
