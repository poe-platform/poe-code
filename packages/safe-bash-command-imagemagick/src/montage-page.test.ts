import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
// Reference output from ImageMagick 7.1.2-35 Q16-HDRI.
it.each([
  { page: [], format: "%wx%h|%g|%W|%H", expected: "2x1|0x0+0+0|0|0" },
  { page: ["-page", "9x8-2+3"], format: "%wx%h|%g|%W|%H", expected: "2x1|9x8-2+3|9|8" },
  { page: ["-page", "9x8-2+3", "+page"], format: "%wx%h|%g|%W|%H", expected: "2x1|0x0+0+0|0|0" },
  { page: [], format: "%wx%h", expected: "2x1" }
])(`reports montage virtual page separately from raster size via ${mode}: $page $format`, async ({ page, format, expected }) => {
  const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", ...page, "-format", format, "info:"];
  const fs = new MemoryFileSystem();
  if (mode === "magick" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const context: CommandContext = {
      command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } },
      stderr: { async write(chunk) { stderr.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk); } }, registerCleanup() {}
    };
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    expect((await command.execute(context)).exitCode).toBe(0);
    expect(Buffer.concat(stdout).toString()).toBe(expected);
    expect(Buffer.concat(stderr).toString()).toBe("");
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
  }
});

for (const mode of ["sync", "buffered", "retained"] as const) {
  it(`preserves page metadata and raster pixels for file-backed montage via ${mode}`, async () => {
    const files = new Map([["tile.ppm", Buffer.from("P3\n1 1\n255\n255 0 0\n")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/tile.ppm", files.get("tile.ppm")!);
    const args = ["tile.ppm", "tile.ppm", "-tile", "2x1", "-geometry", "+0+0", "-page", "9x8-2+3", "miff:-"];
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const image = decodeImage(result.stdoutBytes!);
    expect(image).toMatchObject({ width: 2, height: 1, virtualCanvas: { width: 9, height: 8, x: -2, y: 3 } });
    expect(image.data).toEqual(Uint8Array.of(255, 0, 0, 255, 255, 0, 0, 255));
  });

  it(`rejects missing montage page geometry via ${mode}`, async () => {
    const args = ["-page"];
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: "montage: missing argument for -page\n" });
  });
}
