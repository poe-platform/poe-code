import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMontageCli, runMontageCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
const font = existsSync("/System/Library/Fonts/Supplemental/Arial.ttf")
  ? "/System/Library/Fonts/Supplemental/Arial.ttf" : "DejaVu-Sans";

for (const execution of ["buffered", "retained", "sync"] as const)
it.each([
  { mode: ["Frame"], tile: "2x1", extra: [], width: 80, height: 42 },
  { mode: ["Frame", "Unframe"], tile: "2x1", extra: [], width: 16, height: 8 },
  { mode: ["Frame"], tile: "1x2", extra: ["-mattecolor", "#5588bb", "-background", "none"], width: 42, height: 84 },
  { mode: ["Frame"], tile: "2x1", extra: ["-bordercolor", "lime"], width: 80, height: 42 },
])(`renders montage modes via ${execution}: $mode $tile $extra`, async ({ mode, tile, extra, width, height }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const [name, w, h, background] of [["red.png", 2, 2, "red"], ["blue.png", 4, 1, "blue"]] as const) {
    const bytes = await sharp({ create: { width: w, height: h, channels: 3, background } }).png().toBuffer();
    files.set(name, bytes);
    await fs.writeFile("/" + name, bytes);
  }
  const options = ["-tile", tile, ...extra, "-geometry", "4x4+2+2", ...mode.flatMap(value => ["-mode", value])];
  const args = [...options, ...files.keys(), "png:-"];
  const result = execution === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, execution === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  expect([actual.width, actual.height]).toEqual([width, height]);
  if (mode.at(-1) === "Frame" && !extra.length) {
    // Normalize quantum samples instead of the PNG decoder's high-byte preview.
    const pixels = actual.data16 ? Uint8Array.from(actual.data16, value => Math.round(value / 257)) : actual.data;
    for (const [x, y, color] of [[2, 2, 210], [2, 5, 221], [5, 5, 189], [35, 5, 100]] as const)
      expect(Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4))).toEqual([color, color, color, 255]);
  }
  if (nativeAvailable) {
    const reference = spawnSync("magick", ["montage", "-font", font, ...options,
      ...Array.from(files.values(), bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    let maximumError = 0;
    for (let i = 0; i < actual.data.length; i++) maximumError = Math.max(maximumError, Math.abs(actual.data[i]! - native.data[i]!));
    expect(maximumError).toBeLessThanOrEqual(2);
  }
});
