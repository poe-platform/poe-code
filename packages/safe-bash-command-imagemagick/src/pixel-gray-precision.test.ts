import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI preserves fractional gray as percentages.
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: ["xc:red", "-colorspace", "Gray"], expected: "gray(21.2656%)|0.212656" },
    { args: ["xc:lime", "-colorspace", "Gray"], expected: "gray(71.5158%)|0.715158" },
    { args: ["xc:blue", "-colorspace", "Gray"], expected: "gray(7.2186%)|0.072186" },
    { args: ["xc:red", "-type", "Grayscale"], expected: "gray(21.2656%)|0.212656" },
    { args: ["xc:red", "-colorspace", "Gray", "-precision", "3"], expected: "gray(21.3%)|0.213" },
    { args: ["xc:#ff000080", "-colorspace", "Gray"], expected: "graya(21.2656%,0.501961)|0.212656" },
    { args: ["xc:gray(120)"], expected: "gray(120)|0.470588" },
    { args: ["xc:black", "-colorspace", "Gray"], expected: "gray(0)|0" },
    { args: ["xc:white", "-colorspace", "Gray"], expected: "gray(255)|1" }
  ])(`${mode}: retains grayscale pixel precision for $args`, async ({ args, expected }) => {
    const fs = new MemoryFileSystem();
    const argv = [...args, "-format", "%[pixel:p{0,0}]|%[fx:u.r]", "info:"];
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
