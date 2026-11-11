import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const colors: Record<string, number[]> = {
  R: [255, 0, 0], G: [0, 255, 0], B: [0, 0, 255], Y: [255, 255, 0],
  K: [0, 0, 0], W: [255, 255, 255], C: [0, 255, 255], M: [255, 0, 255]
};

// Pixel grids verified against native ImageMagick, including ungrouped controls.
for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
  { inputs: ["(", "in.ppm", "-trim", ")", "in.ppm"], width: 6, height: 3, grid: "KKWWWWWWWKKWWWWWWW" },
  { inputs: ["in.ppm", "(", "in.ppm", "-trim", ")"], width: 6, height: 3, grid: "WWWWWWWKKWKKWWWWWW" },
  { inputs: ["in.ppm", "in.ppm", "-trim"], width: 4, height: 1, grid: "KKKK" },
  { inputs: ["in.ppm", "in.ppm"], width: 8, height: 3, grid: "WWWWWWWWWKKWWKKWWWWWWWWW" }
])(`scopes montage trim via ${mode}: $inputs`, async ({ inputs, width, height, grid }) => {
  const bytes = new Uint8Array([...new TextEncoder().encode("P6\n4 3\n255\n"), ...[..."WWWWWKKWWWWW"].flatMap(pixel => colors[pixel]!)]);
  const files = new Map([["in.ppm", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.ppm", bytes);
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
  expect([actual.width, actual.height]).toEqual([width, height]);
  expect(actual.data).toEqual(new Uint8Array([...grid].flatMap(pixel => [...colors[pixel]!, 255])));
});
