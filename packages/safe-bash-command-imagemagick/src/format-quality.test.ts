import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35: explicit properties override image quality;
// setting the property does not change the encoder quality or its fallback.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: ["xc:red"], expected: "0;" },
    { args: ["xc:red", "-quality", "70"], expected: "70;" },
    { args: ["-quality", "70", "xc:red"], expected: "70;" },
    { args: ["xc:red", "-quality", "70", "xc:blue"], expected: "70;70;" },
    { args: ["-respect-parentheses", "(", "xc:red", "-quality", "70", ")", "xc:blue"], expected: "70;0;" },
    { args: ["xc:red", "-quality", "70", "-append"], expected: "70;" },
    { args: ["xc:red", "-set", "quality", "70"], expected: "70;" },
    { args: ["xc:red", "-set", "quality", "marker"], expected: "marker;" },
    { args: ["xc:red", "-set", "quality", ""], expected: ";" },
    { args: ["xc:red", "-set", "quality", "70", "+set", "quality"], expected: "0;" },
    { args: ["xc:red", "-quality", "70", "-set", "quality", "50"], expected: "50;" },
    { args: ["xc:red", "-set", "quality", "50", "-quality", "70"], expected: "50;" },
    { args: ["xc:red", "-set", "quality", "50", "-append"], expected: "50;" },
    { args: ["xc:red", "-set", "quality", "70"], format: "%[quality]|%Q|%[fx:quality];", expected: "70|92|0;" },
    { args: ["xc:red", "-quality", "70"], format: "%[quality]|%Q|%[fx:quality];", expected: "70|70|70;" }
  ])(`formats explicit quality (${mode}): $args $format`, async ({ args, format, expected }) => {
    const fs = new MemoryFileSystem();
    const argv = [...args, "-format", format ?? "%[quality];", "info:-"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
      .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}
