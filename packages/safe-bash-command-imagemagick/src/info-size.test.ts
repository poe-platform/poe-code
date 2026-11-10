import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const tile = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");
const format = "%[size]|%b|%B\n";

for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  it.each([
    { args: ["/tile.ppm", "-format", format, "info:"], expected: "0B|67B|67\n" },
    { args: ["/tile.ppm", "-resize", "1x1!", "-format", format, "info:"], expected: "0B|67B|67\n" },
    { args: ["/tile.ppm", "/tile.ppm", "-format", format, "info:/sizes.txt"], expected: "0B|67B|67\n0B|67B|67\n" },
    { args: ["identify", "-format", format, "/tile.ppm"], expected: "67B|67B|67\n" },
    { args: ["/tile.ppm", "-set", "label", format, "-format", "%l", "info:"], expected: "67B|67B|67\n" }
  ])(`${mode}: resolves size in its formatting context ($args)`, async ({ args, expected }) => {
    const files = new Map([["/tile.ppm", tile]]), fs = new MemoryFileSystem();
    await fs.writeFile("/tile.ppm", tile);
    let result;
    if (mode === "sync") result = runMagickCliSync(args, files);
    else if (mode !== "command") result = await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    else {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      result = { ...status, stdout, stderr };
    }
    const outputFile = args.at(-1) === "info:/sizes.txt";
    expect(result).toEqual({ exitCode: 0, stdout: outputFile ? "" : expected, stderr: "" });
    if (outputFile) {
      const bytes = mode === "command" || mode === "retained" ? await fs.readFile("/sizes.txt") : files.get("/sizes.txt");
      expect(new TextDecoder().decode(bytes)).toBe(expected);
    }
  });
}
