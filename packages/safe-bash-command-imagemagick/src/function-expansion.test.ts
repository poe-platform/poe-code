import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

describe.each(["command", "retained", "buffered", "sync"] as const)("function coefficient expansion (%s)", mode => {
  it.each([
    { input: ["-set", "option:coef", "0.5,0", "xc:#20406080"], coefficients: "%[option:coef]", expected: "10203040" },
    { input: ["-set", "option:coef", "0.5,0", "xc:#20406080"], coefficients: "%[fx:1/2],0", expected: "10203040" },
    { input: ["xc:#20406080"], coefficients: "0.5,0", expected: "10203040" },
    { input: ["xc:#20406080", "-set", "coef", "0.5,0"], coefficients: "%[coef]", expected: "10203040" },
    { input: ["xc:#20406080", "xc:#20406080"], coefficients: "%[fx:(t+1)/2],0", expected: "1020304020406080" },
    { input: ["-set", "option:coef", "bogus", "xc:#20406080"], coefficients: "%[option:coef]", expected: "", exitCode: 1 },
    { input: ["xc:#808080", "-duplicate", "4", "-combine", "-channel", "Meta0"], coefficients: "%[fx:1/2],0", output: ["-channel", "Meta0", "-separate", "+channel", "rgba:-"], expected: "404040ff" },
    { input: ["xc:#808080", "-duplicate", "4", "-combine", "-channel", "R"], coefficients: "%[fx:1/2],0", output: ["-channel", "Meta0", "-separate", "+channel", "rgba:-"], expected: "808080ff" }
  ])("expands $coefficients with $input", async ({ input, coefficients, expected, exitCode = 0, output = ["rgba:-"] }) => {
    const argv = [...input, "-function", "Polynomial", coefficients, "-depth", "8", ...output];
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
    expect(result.exitCode, "stderr" in result ? result.stderr : stderr).toBe(exitCode);
    if (exitCode === 0) expect("stderr" in result ? result.stderr : stderr).toBe("");
    else expect("stderr" in result ? result.stderr : stderr).toContain("invalid list of numbers");
    const bytes = mode === "command" ? Buffer.concat(chunks)
      : "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? Buffer.from(result.stdoutBytes)
      : Buffer.from("stdout" in result && typeof result.stdout === "string" ? result.stdout : "");
    expect(bytes.toString("hex")).toBe(expected);
  });
});
