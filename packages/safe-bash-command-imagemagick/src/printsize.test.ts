import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCli, runIdentifyCliSync, runMagickCli, runMagickCliSync } from "./index.js";

const tile = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");
const placed = encodeImage({ ...decodeImage(tile), resolution: { x: 3937, y: 7874, unit: "meter" },
  virtualCanvas: { width: 9, height: 7, x: 2, y: 1 } }, { format: "png" }).data;

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  for (const prefix of ["", "fx:"]) {
    it.each([
      { filename: "/tile.ppm", input: tile, expected: "3e+12|2e+12" },
      { filename: "/placed.png", input: placed, expected: "0.0762002|0.0254001" }
    ])(`${mode}: ${prefix}printsize uses raster dimensions and each resolution axis ($filename)`, async ({ filename, input, expected }) => {
      // Expected values verified against ImageMagick 7.1.2-35 Q16-HDRI.
      const files = new Map([[filename, input]]), fs = new MemoryFileSystem();
      await fs.writeFile(filename, input);
      const args = ["-format", `%[${prefix}printsize.x]|%[${prefix}printsize.y]`, filename];
      const argumentValues = createCommandArguments(["identify", ...args]);
      let stdout = "", stderr = "";
      const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      }) : mode === "sync" ? runIdentifyCliSync(args, files)
        : await runIdentifyCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect("stdout" in result ? result : { ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    });
  }

  it.each([
    { density: "100x200", expected: "0.03|0.01|0.03|0.01" },
    { density: "0x200", expected: "3e+12|0.01|3e+12|0.01" },
    { density: "100x0", expected: "0.03|2e+12|0.03|2e+12" }
  ])(`${mode}: printsize follows density edits before info output ($density)`, async ({ density, expected }) => {
    const files = new Map([["/tile.ppm", tile]]), fs = new MemoryFileSystem();
    await fs.writeFile("/tile.ppm", tile);
    const args = ["/tile.ppm", "-units", "PixelsPerInch", "-density", density, "-repage", "9x7+2+1",
      "-format", "%[printsize.x]|%[printsize.y]|%[fx:printsize.x]|%[fx:printsize.y]", "info:"];
    const argumentValues = createCommandArguments(args);
    let stdout = "", stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    }) : mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stdout" in result ? result : { ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
  it(`${mode}: pixel FX can calculate the ratio of physical dimensions`, async () => {
    const files = new Map([["/placed.png", placed]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/placed.png", placed);
    const args = ["/placed.png", "-fx", "printsize.y/printsize.x", "/out.png"];
    const result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data]).toEqual(Array.from({ length: 6 }, () => [85, 85, 85, 255]).flat());
  });
}
