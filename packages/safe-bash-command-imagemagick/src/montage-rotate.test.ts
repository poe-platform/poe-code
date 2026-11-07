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
it.each([0, 90, -90, 180])(`rotates montage inputs before layout via ${mode}: %s`, async angle => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const color of ["red", "blue"]) {
    const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: color } }).png().toBuffer();
    files.set(`${color}.png`, bytes);
    await fs.writeFile(`/${color}.png`, bytes);
  }
  const args = ["-geometry", "+0+0", "-tile", "2x1", "-rotate", String(angle), ...files.keys(), "png:-"];
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
  const width = Math.abs(angle) === 90 ? 2 : 4, height = 4 / width;
  expect([actual.width, actual.height]).toEqual([width, height]);
  const expected = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    expected.set(x < width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * width + x) * 4);
  }
  expect(actual.data).toEqual(expected);
  const reference = spawnSync("magick", ["montage", "-font", font, ...args.slice(0, 6),
    ...Array.from(files.values(), bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
  if (!reference.error) {
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    expect(actual.data).toEqual(native.data);
  }
});
