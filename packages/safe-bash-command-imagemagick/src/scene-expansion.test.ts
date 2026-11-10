import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI results, before the info writer renumbers scenes.
describe.each(["command", "retained", "buffered", "sync"] as const)("operator scene expansion (%s)", mode => {
  it.each([
    { options: ["-color-matrix", "%[scene]"], expected: "003050002040", pixels: true },
    { options: ["-color-matrix", "%s"], expected: "003050002040", pixels: true },
    { options: ["-scene", "2", "-color-matrix", "%s"], expected: "403050c02040", pixels: true },
    { options: ["-gamma", "%[scene]"], expected: "000000000000", pixels: true },
    { options: ["-scene", "2", "-set", "label", "%s"], expected: "2;2;" },
    { options: ["-color-matrix", "%[fx:t]"], expected: "003050602040", pixels: true },
    { options: ["-scene", "2", "-color-matrix", "%p"], expected: "003050602040", pixels: true },
    { options: ["-color-matrix", "%p"], expected: "003050602040", pixels: true },
    { options: ["-set", "label", "%[scene]"], expected: "0;0;" },
    { options: ["-set", "scene", "2", "-color-matrix", "%[scene]"], expected: "403050c02040", pixels: true },
    { options: ["-set", "scene", "2", "-color-matrix", "%s"], expected: "003050002040", pixels: true },
    { options: ["-scene", "2", "-set", "scene", "3", "-set", "label", "%s/%[scene]"], expected: "2/3;2/3;" }
  ])("expands $options", async ({ options, expected, pixels = false }) => {
    const argv = ["xc:#203050", "xc:#602040", ...options,
      ...(pixels ? ["+append", "-depth", "8", "rgb:-"] : ["-format", "%[label];", "info:-"])];
    const fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const argumentValues = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(argv, new Map())
      : await runMagickCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map());
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const bytes = mode === "command" ? Buffer.concat(chunks)
      : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
      : Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
    expect(bytes.toString(pixels ? "hex" : "utf8")).toBe(expected);
  });
});
