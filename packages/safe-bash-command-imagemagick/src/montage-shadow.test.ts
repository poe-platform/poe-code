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
it.each([[], ["-shadow"], ["+shadow"], ["-shadow", "+shadow"], ["+shadow", "-shadow"]].map(options => ({ options })))(`toggles montage shadows via ${mode}: %j`, async ({ options }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  const pixels = new Uint8Array(3 * 3 * 4).fill(255);
  pixels.set([255, 0, 0, 255], 4 * 4);
  const bytes = await sharp(pixels, { raw: { width: 3, height: 3, channels: 4 } }).png().toBuffer();
  const shadow = options.at(-1) === "-shadow";
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
  expect([actual.width, actual.height]).toEqual(shadow ? [7, 7] : [3, 3]);
  if (!shadow) expect(actual.data).toEqual(pixels);
  else {
    expect(Array.from(actual.data.slice((6 * 7 + 6) * 4))).toEqual([254, 254, 254, 255]);
    expect(Array.from(actual.data.slice((1 * 7 + 1) * 4, (1 * 7 + 2) * 4))).toEqual([255, 0, 0, 255]);
  }
  const reference = spawnSync("magick", ["montage", "-font", font, ...args.slice(0, -2),
    ...Array.from(files.values(), bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
  if (!reference.error) {
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    expect(actual.data).toEqual(native.data);
  }
});
