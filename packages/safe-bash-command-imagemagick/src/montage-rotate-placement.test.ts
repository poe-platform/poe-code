import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const colors: Record<string, number[]> = {
  R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], Y: [255, 255, 0],
  K: [0, 0, 0], W: [255, 255, 255], C: [0, 255, 255], M: [255, 0, 255]
};

// Complete pixel grids captured from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { inputs: ["a.ppm", "-rotate", "90", "b.ppm"], grid: "YBCKGRMW" },
    { inputs: ["a.ppm", "-rotate", "180", "b.ppm"], grid: "RGMCBYWK" },
    { inputs: ["-rotate", "90", "a.ppm", "b.ppm"], grid: "BRCKYGMW" },
    { inputs: ["a.ppm", "b.ppm", "-rotate", "90"], grid: "BRCKYGMW" }
  ])(`matches montage rotation placement via ${mode}: $inputs`, async ({ inputs, grid }) => {
    const fs = new MemoryFileSystem();
    const files = new Map<string, Uint8Array>();
    for (const [name, pixels] of [["a.ppm", "RGBY"], ["b.ppm", "KWCM"]]) {
      const bytes = new Uint8Array([...new TextEncoder().encode("P6\n2 2\n255\n"),
        ...Array.from(pixels!, color => colors[color]!).flat()]);
      files.set(name!, bytes);
      await fs.writeFile(`/${name}`, bytes);
    }
    const args = ["-geometry", "+0+0", "-tile", "2x1", ...inputs, "-depth", "8", "ppm:-"];
    let output: Uint8Array;
    if (mode === "command") {
      const argumentValues = createCommandArguments(["montage", ...args.slice(0, -1), "sheet.ppm"]);
      const stderr: unknown[] = [];
      const context: CommandContext = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = await fs.readFile("/sheet.ppm");
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    const actual = decodeImage(output);
    expect([actual.width, actual.height]).toEqual([4, 2]);
    expect(actual.data).toEqual(new Uint8Array(Array.from(grid, color => [...colors[color]!, 255]).flat()));
  });
}
