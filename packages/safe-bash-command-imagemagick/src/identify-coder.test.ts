import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli } from "./index.js";

const ppm = new TextEncoder().encode("P3\n2 1\n255\n255 0 0 0 255 0\n");

it.each(["a.ppm", "ppm:a.ppm", "pnm:a.ppm", "png:a.ppm", "rgb:a.ppm", "png:a.ppm[0]", "png:a.ppm[0-0]", "ppm:a.ppm[0-0]"])("identify honors the requested coder in %s", async input => {
  const args = ["-format", "%wx%h:%[fx:p{0,0}.r]", input];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a.ppm", ppm);
  const argumentValues = createCommandArguments(["identify", ...args]);
  let stdout = "", stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  for (const actual of [{ ...result, stdout, stderr }, await runIdentifyCli(args, new Map([["a.ppm", ppm]]))]) {
    if (input.startsWith("png:") || input.startsWith("rgb:")) {
      expect(actual.exitCode).toBe(1);
      expect(actual.stdout).toBe("");
      expect(actual.stderr).toContain(input.startsWith("rgb:") ? "must specify image size" : "improper image header");
    } else expect(actual).toEqual({ exitCode: 0, stdout: "2x1:1", stderr: "" });
  }
});
