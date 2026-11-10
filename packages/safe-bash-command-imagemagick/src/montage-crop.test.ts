import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const colors: Record<string, number[]> = {
  R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], Y: [255, 255, 0],
  K: [0, 0, 0], W: [255, 255, 255], C: [0, 255, 255], M: [255, 0, 255]
};

// Native ImageMagick RGB grids, including the filename-selector control.
for (const mode of ["sync", "buffered", "retained", "command", "montage"] as const)
it.each([
  { options: ["tile.ppm", "-crop", "1x1+1+1"], grid: "Y" },
  { options: ["tile.ppm", "-crop", "1x1"], grid: "RGBY" },
  { options: ["tile.ppm[1x1+1+1]"], grid: "Y" },
  { options: ["-crop", "1x1", "tile.ppm"], grid: "RGBY" },
  { options: ["tile.ppm", "-flop", "-crop", "1x1"], grid: "GRYB" },
  { options: ["tile.ppm", "-crop", "1x1", "-flop"], grid: "RGBY" },
  { options: ["tile.ppm", "-gravity", "southeast", "-crop", "1x1+0+0"], grid: "Y" },
])(`crops montage inputs via ${mode}: $options`, async ({ options, grid }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const [name, pixels] of [["tile.ppm", "RGBY"]] as const) {
    const bytes = new Uint8Array([...new TextEncoder().encode("P6\n2 2\n255\n"), ...[...pixels].flatMap(pixel => colors[pixel]!)]);
    files.set(name, bytes);
    await fs.writeFile(`/${name}`, bytes);
  }
  const args = ["-geometry", "+0+0", "-tile", "x1", ...options, "-depth", "8", "ppm:-"];
  let output: Uint8Array;
  if (mode === "command" || mode === "montage") {
    const argumentValues = createCommandArguments([...(mode === "command" ? ["montage"] : []), ...args.slice(0, -1), "sheet.ppm"]);
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: mode === "command" ? "magick" : "montage", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    expect((await (mode === "command" ? createMagickCommand() : createMontageCommand()).execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
    output = await fs.readFile("/sheet.ppm");
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual([grid.length, 1]);
  expect(actual.data).toEqual(new Uint8Array([...grid].flatMap(pixel => [...colors[pixel]!, 255])));
});

it("rejects a missing montage crop geometry", () => {
  expect(runMontageCliSync(["-crop"], new Map())).toMatchObject({
    exitCode: 1, stderr: "montage: missing argument for -crop\n"
  });
});
