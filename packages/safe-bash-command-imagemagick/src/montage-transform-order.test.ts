import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const colors: Record<string, number[]> = {
  R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], Y: [255, 255, 0],
  K: [0, 0, 0], W: [255, 255, 255], C: [0, 255, 255], M: [255, 0, 255]
};

// Native pixel grids in row order, with reversed-order controls and repeated rotation.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
  { options: ["-rotate", "90", "-flip"], grid: "YGMWBRCK" },
  { options: ["-flip", "-rotate", "90"], grid: "RBKCGYWM" },
  { options: ["-rotate", "90", "-flop"], grid: "RBKCGYWM" },
  { options: ["-flop", "-rotate", "90"], grid: "YGMWBRCK" },
  { options: ["-rotate", "90", "-transpose"], grid: "BYCMRGKW" },
  { options: ["-transpose", "-rotate", "90"], grid: "GRWKYBMC" },
  { options: ["-rotate", "90", "-flip", "-rotate", "90"], grid: "BYCMRGKW" }
])(`preserves montage transform order via ${mode}: $options`, async ({ options, grid }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const [name, pixels] of [["a.ppm", "RGBY"], ["b.ppm", "KWCM"]] as const) {
    const bytes = new Uint8Array([...new TextEncoder().encode("P6\n2 2\n255\n"), ...[...pixels].flatMap(pixel => colors[pixel]!)]);
    files.set(name, bytes);
    await fs.writeFile(`/${name}`, bytes);
  }
  const args = ["-geometry", "+0+0", "-tile", "2x1", ...files.keys(), ...options, "ppm:-"];
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
  expect(actual.data).toEqual(new Uint8Array([...grid].flatMap(pixel => [...colors[pixel]!, 255])));
});
