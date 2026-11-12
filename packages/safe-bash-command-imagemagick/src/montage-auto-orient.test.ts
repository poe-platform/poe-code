import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const files = new Map(Array.from({ length: 8 }, (_, index) => {
  const orientation = index + 1;
  const data = Uint8Array.from(Array.from({ length: 24 * 16 }, (_, pixel) => {
    const value = 32 * (1 + Math.floor(pixel % 24 / 8) + 3 * Math.floor(pixel / 24 / 8));
    return [value, value, value, 255];
  }).flat());
  return [`/o${orientation}.jpg`, encodeImage({ width: 24, height: 16, data,
    format: "jpeg", space: "srgb", channels: 3, depth: "uchar", density: 72,
    hasAlpha: false, orientation }, { format: "jpeg", quality: 100 }).data] as const;
}));

const grids = [
  [[1, 2, 3], [4, 5, 6]], [[3, 2, 1], [6, 5, 4]],
  [[6, 5, 4], [3, 2, 1]], [[4, 5, 6], [1, 2, 3]],
  [[1, 4], [2, 5], [3, 6]], [[4, 1], [5, 2], [6, 3]],
  [[6, 3], [5, 2], [4, 1]], [[3, 6], [2, 5], [1, 4]]
];
const cases = [
  ...grids.map((grid, index) => ({ inputs: [`/o${index + 1}.jpg`], options: ["-auto-orient"], grid })),
  { inputs: ["/o6.jpg"], options: [], grid: grids[0]! },
  { inputs: ["/o6.jpg"], options: ["-crop", "16x8+8+8"], grid: [[5, 6]] },
  { inputs: ["/o6.jpg", "/o2.jpg"], options: ["-auto-orient"], grid: [[4, 1, 3, 2, 1], [5, 2, 6, 5, 4], [6, 3, 0, 0, 0]] },
  { inputs: ["/o6.jpg"], options: ["-auto-orient", "-auto-orient"], grid: grids[5]! }
];

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each(cases)(`orients JPEG montage tiles via ${mode}: $inputs $options`, async ({ inputs, options, grid }) => {
  const args = [...inputs, ...options, "-tile", `${inputs.length}x1`, "-geometry", "+0+0", "-background", "black", "-depth", "8", "ppm:-"];
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
      fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout.push(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    output = Buffer.concat(stdout);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const image = decodeImage(output);
  expect([image.width, image.height]).toEqual([grid[0]!.length * 8, grid.length * 8]);
  expect(grid.map((row, y) => row.map((_, x) => Math.floor(image.data[((4 + 8 * y) * image.width + 4 + 8 * x) * 4]! / 32)))).toEqual(grid);
});
