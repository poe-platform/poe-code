import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick does not store these reserved names as string properties.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { edits: ["-set", "gravity", "West"], format: "%[gravity];", stdout: ";", warning: "gravity" },
    { edits: ["-set", "intent", "Perceptual"], format: "%[intent];", stdout: ";", warning: "intent" },
    { edits: ["-set", "interpolate", "Nearest"], format: "%[interpolate];", stdout: ";", warning: "interpolate" },
    { edits: ["-set", "GRAVITY", "West"], format: "%[gravity];", stdout: ";", warning: "gravity" },
    { edits: ["-gravity", "East", "-set", "gravity", "West"], format: "%[gravity];", stdout: "East;" },
    { edits: ["-set", "demo", "amber"], format: "%[demo]|%[option:demo]|%[artifact:demo]", stdout: "amber||", warning: "option:demo", secondWarning: "artifact:demo" },
    { edits: ["-set", "filter", "Box"], format: "%[filter];", stdout: "Box;" }
  ])(`preserves native property lookup (${mode}): $edits`, async ({ edits, format, stdout: expected, warning, secondWarning }) => {
    const argv = ["xc:red", ...edits, "-format", format, "info:-"];
    const fs = new MemoryFileSystem();
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe(expected);
    expect("stderr" in result ? result.stderr : stderr).toBe(
      [warning, secondWarning].filter(Boolean).map(key => `magick: unknown image property '%[${key}]'\n`).join("")
    );
  });
}
