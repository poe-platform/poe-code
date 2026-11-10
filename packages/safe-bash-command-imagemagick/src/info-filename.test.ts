import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const bytes = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([false, true])(`distinguishes INFO and identify filenames via ${mode} (identify=%s)`, async identify => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/tile.ppm", bytes);
    const files = new Map([["tile.ppm", bytes]]);
    const args = identify ? ["identify", "-format", "%i|%f", "tile.ppm"] : ["tile.ppm", "-format", "%i|%f", "info:"];
    let result;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      result = { ...status, stdout, stderr };
    } else {
      result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    }
    expect(result).toEqual({ exitCode: 0, stdout: identify ? "tile.ppm|tile.ppm" : "|tile.ppm", stderr: "" });
    expect(await fs.readFile("/tile.ppm")).toEqual(bytes);
  });
}
