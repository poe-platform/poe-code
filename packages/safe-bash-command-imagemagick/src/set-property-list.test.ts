import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: expansion uses the list at assignment time.
describe.each(["command", "retained", "buffered", "sync"] as const)("-set image list (%s)", mode => {
  it.each(["label", "comment", "mytag"].flatMap(property => [
    { property, value: "%p", expected: "1" },
    { property, value: "%s:%p:%[fx:t]", expected: "0:1:1" },
    { property, value: "%[fx:t]", expected: "1" },
    { property, value: "%n", expected: "2" },
    { property, value: "%[fx:u[0].r]", expected: "0.12549" },
    { property, value: "fixed", expected: "fixed" }
  ]))("stores $value in $property before deleting the first image", async ({ property, value, expected }) => {
    const argv = ["xc:#203050", "xc:#602040", "-set", property, value, "-delete", "0", "-format", `%[${property}]`, "info:-"];
    const fs = new MemoryFileSystem();
    let stdout = "", stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect({ stdout, stderr, ...result }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
});
