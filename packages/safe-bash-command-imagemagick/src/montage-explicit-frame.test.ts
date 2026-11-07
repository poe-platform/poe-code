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
  { options: ["-frame", "2x2+1+1"], border: 2 },
  { options: ["-frame", "3"], border: 3 },
  { options: ["-frame", "2x3+1+1"], border: 3 },
  { options: ["+frame"], border: 0 },
  { options: ["-mode", "Frame", "+shadow", "-frame", "2x2+1+1"], border: 2 },
  { options: ["-frame", "2x2+1+1", "-mode", "Unframe"], border: 0 },
  { options: ["-frame", "2x2+1+1", "+frame"], border: 0 },
  { options: ["+frame", "-frame", "2x2+1+1"], border: 2 }
])(`renders montage frames via ${mode}: %j`, async ({ options, border }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
  const bytes = await sharp(pixels, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
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
  expect([actual.width, actual.height]).toEqual([2 + border * 2, 1 + border * 2]);
  const left = options.includes("2x3+1+1") ? 2 : border;
  const offset = (border * actual.width + left) * 4;
  expect(actual.data.slice(offset, offset + 8)).toEqual(pixels);
  const reference = spawnSync("magick", ["montage", "-font", font, ...args.slice(0, -2),
    ...Array.from(files.values(), bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
  if (!reference.error) {
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    let maximumError = 0;
    for (let i = 0; i < actual.data.length; i++) maximumError = Math.max(maximumError, Math.abs(actual.data[i]! - native.data[i]!));
    expect(maximumError).toBeLessThanOrEqual(2);
  }
});

it("reports a missing montage frame argument", () => {
  expect(runMontageCliSync(["-frame"], new Map())).toMatchObject({ exitCode: 1, stderr: "montage: missing argument for -frame\n" });
});
