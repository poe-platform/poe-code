import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    ["xc:red", "XC"],
    ["canvas:red", "CANVAS"],
    ["gradient:red-blue", "GRADIENT"],
    ["radial-gradient:red-blue", "RADIAL-GRADIENT"],
    ["pattern:checkerboard", "PATTERN"],
    ["/red.ppm", "PPM"],
  ])(`${mode}: preserves %m and %[magick] for %s`, async (input, format) => {
    const files = new Map([["/red.ppm", new TextEncoder().encode("P3\n3 1\n255\n255 0 0 255 0 0 255 0 0\n")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = ["-size", "3x2", input, "-format", "%m|%[magick]", "info:"];
    const argumentValues = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
      : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect("stdout" in result ? result.stdout : stdout).toBe(`${format}|${format}`);
  });
}
