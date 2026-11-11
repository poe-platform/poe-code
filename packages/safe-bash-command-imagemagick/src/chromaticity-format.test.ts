import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI exposes the original option text, not image metadata.
const names = ["red-primary", "green-primary", "blue-primary", "white-point"];
const values = ["0.5,0.33", "0.22,0.68", "0.17,0.09", "0.3,0.31"];
const settings = names.flatMap((name, index) => [`-${name}`, values[index]!]);
const format = names.map(name => `%[${name}]`).join("|");

for (const mode of ["command", "buffered", "sync"] as const) {
  it.each<{ input: string[]; format: string; expected: string; missing?: string[] }>([
    { input: ["xc:red", ...settings], format, expected: values.join("|") },
    { input: [...settings, "xc:red"], format, expected: values.join("|") },
    { input: ["xc:red"], format, expected: "|||", missing: names },
    ...names.flatMap(name => [
      { input: ["xc:red", `-${name}`, "0.50x0.330"], format: `%[${name}]|%[option:${name}]`, expected: "0.50x0.330|0.50x0.330" },
      { input: ["xc:red", `-${name}`, "0.4"], format: `%[${name}]`, expected: "0.4" },
      { input: ["xc:red", ...settings, `+${name}`], format, expected: values.map((value, index) => names[index] === name ? "0.0" : value).join("|") }
    ]),
    { input: ["-respect-parentheses", "-red-primary", "0.5,0.33", "(", "xc:red", "-red-primary", "0.7,0.3", ")"], format: "%[red-primary]", expected: "0.5,0.33" },
    { input: ["-red-primary", "0.5,0.33", "(", "xc:red", "-red-primary", "0.7,0.3", ")"], format: "%[red-primary]", expected: "0.7,0.3" },
    { input: ["-respect-parentheses", "(", "xc:red", "-red-primary", "0.7,0.3", ")"], format: "%[red-primary]", expected: "", missing: ["red-primary"] },
    { input: ["xc:red", "-set", "red-primary", "custom", "-red-primary", "0.5,0.33"], format: "%[red-primary]|%[option:red-primary]", expected: "custom|0.5,0.33" }
  ])(`${mode} formats chromaticity settings with $input`, async ({ input, format, expected, missing }) => {
    const args = [...input, "-format", format, ...(missing ? [] : ["-write", "info:/format.txt"]), "info:"];
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    let result;
    if (mode === "sync") result = runMagickCliSync(args, files);
    else if (mode === "buffered") result = await runConvertCli(args, files);
    else {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    }
    expect(result).toEqual({
      exitCode: 0, stdout: expected,
      stderr: (missing ?? []).map(name => `magick: unknown image property '%[${name}]'\n`).join("")
    });
    if (!missing) expect(new TextDecoder().decode(mode === "command" ? await fs.readFile("/format.txt") : files.get("/format.txt"))).toBe(expected);
  });
}
