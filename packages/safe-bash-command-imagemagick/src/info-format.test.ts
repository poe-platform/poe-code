import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const target of ["info:", "info:-", "info:/result.txt"]) {
    it.each([
      { format: "%w", expected: "32" },
      { format: "%w\\n", expected: "3\n2\n" },
      { format: "", expected: "" },
      { format: undefined, expected: "/tile.ppm[0] PPM 3x2 3x2+0+0 8-bit sRGB 67B 0.000u 0:00.000\n/solid.ppm[1] PPM 2x1 2x1+0+0 8-bit sRGB 32B 0.000u 0:00.000\n" }
    ])(`${mode} ${target} preserves INFO format bytes ($format)`, async ({ format, expected }) => {
      const files = new Map<string, Uint8Array>([
        ["/tile.ppm", new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n")],
        ["/solid.ppm", new TextEncoder().encode("P3\n2 1\n255\n64 96 128  64 96 128\n")]
      ]);
      const fs = new MemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const args = ["/tile.ppm", "/solid.ppm", ...(format === undefined ? [] : ["-format", format]), target];
      let result;
      if (mode === "command") {
        let stdout = "", stderr = "";
        const argumentValues = createCommandArguments(args);
        const status = await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        });
        result = { ...status, stdout, stderr };
      } else result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      const fileOutput = target === "info:/result.txt";
      expect(result).toEqual({ exitCode: 0, stdout: fileOutput ? "" : expected, stderr: "" });
      if (fileOutput) expect(new TextDecoder().decode(mode === "map" || mode === "sync"
        ? files.get("/result.txt") : await fs.readFile("/result.txt"))).toBe(expected);
    });
  }
}
