import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const font = existsSync("/System/Library/Fonts/Supplemental/Arial.ttf")
  ? "/System/Library/Fonts/Supplemental/Arial.ttf" : "DejaVu-Sans";

for (const mode of ["sync", "buffered", "retained", "command"] as const)
it.each([
  { options: ["-transpose"], order: [0, 1], width: 1, height: 2, inputWidth: 2, inputHeight: 1 },
  { options: [], order: [0, 1, 2, 3, 4, 5], width: 3, height: 2 },
  { options: ["-transpose"], order: [0, 3, 1, 4, 2, 5], width: 2, height: 3 },
  { options: ["-transpose", "-transpose"], order: [0, 1, 2, 3, 4, 5], width: 3, height: 2 },
])(`transposes montage input pixels via ${mode}: $options`, async ({ options, order, width, height, inputWidth = 3, inputHeight = 2 }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255], [255, 0, 255, 255], [0, 255, 255, 255]];
  const bytes = await sharp(new Uint8Array(colors.slice(0, inputWidth * inputHeight).flat()), { raw: { width: inputWidth, height: inputHeight, channels: 4 } }).png().toBuffer();
  files.set("a.png", bytes);
  await fs.writeFile("/a.png", bytes);
  const args = ["-geometry", "+0+0", ...options, "a.png", "png:-"];
  let output: Uint8Array;
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args.slice(0, -1), "sheet.png"]);
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
    output = await fs.readFile("/sheet.png");
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual([width, height]);
  expect(actual.data).toEqual(new Uint8Array(order.flatMap(index => colors[index]!)));
  const reference = spawnSync("magick", ["montage", "-font", font, ...args.slice(0, -2),
    ...Array.from(files.values(), bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
  if (!reference.error) {
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    expect(actual.data).toEqual(native.data);
  }
});
