import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMontageCli, runMontageCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
const font = existsSync("/System/Library/Fonts/Supplemental/Arial.ttf")
  ? "/System/Library/Fonts/Supplemental/Arial.ttf" : "DejaVu-Sans";

for (const mode of ["sync", "buffered", "retained"] as const)
it.each([
  { gravity: [], top: 2 },
  { gravity: ["-gravity", "Center"], top: 2 },
  { gravity: ["-gravity", "NorthWest"], top: 1 },
  { gravity: ["-gravity", "None"], top: 1 },
  { gravity: ["-gravity", "Forget"], top: 1 },
  { gravity: ["-gravity", "SouthEast"], top: 4 },
])(`positions unequal montage tiles via ${mode}: $gravity`, async ({ gravity, top }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const [name, width, height, background] of [["red.png", 2, 2, "red"], ["blue.png", 4, 1, "blue"]] as const) {
    const bytes = await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
    files.set(name, bytes);
    await fs.writeFile("/" + name, bytes);
  }
  const options = ["-tile", "2x1", "-geometry", "4x4+1+1", ...gravity];
  const args = [...options, ...files.keys(), "png:-"];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  expect([actual.width, actual.height]).toEqual([12, 6]);
  const expected = new Uint8Array(12 * 6 * 4).fill(255);
  for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) expected.set([255, 0, 0, 255], (y * 12 + x) * 4);
  for (let x = 7; x < 11; x++) expected.set([0, 0, 255, 255], (top * 12 + x) * 4);
  expect(Buffer.from(actual.data).equals(expected)).toBe(true);
  if (nativeAvailable) {
    const reference = spawnSync("magick", ["montage", "-font", font, ...options,
      ...Array.from(files.values(), bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    expect(Buffer.from(actual.data).equals(native.data)).toBe(true);
  }
});
