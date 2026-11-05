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
for (const geometry of [[], ["-geometry", "+0+0"]])
it.each([
  { count: 1, columns: 1, rows: 1, tile: [] },
  { count: 2, columns: 2, rows: 1, tile: [] },
  { count: 3, columns: 3, rows: 1, tile: [] },
  { count: 4, columns: 2, rows: 2, tile: [] },
  { count: 5, columns: 3, rows: 2, tile: [] },
  { count: 6, columns: 3, rows: 2, tile: [] },
  { count: 7, columns: 4, rows: 2, tile: [] },
  { count: 8, columns: 4, rows: 2, tile: [] },
  { count: 9, columns: 3, rows: 3, tile: [] },
  { count: 3, columns: 2, rows: 2, tile: ["-tile", "2x"] },
  { count: 3, columns: 2, rows: 2, tile: ["-tile", "x2"] },
  { count: 2, columns: 2, rows: 1, tile: ["-tile", "2x1"] },
])(`lays out $count montage tiles via ${mode} with ${geometry}: $tile`, async ({ count, columns, rows, tile }) => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["input.png", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const options = [...geometry, ...tile];
  const args = [...options, ...Array<string>(count).fill("input.png"), "png:-"];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  const cellWidth = geometry.length ? 2 : 128, cellHeight = geometry.length ? 2 : 126;
  const width = columns * cellWidth, height = rows * cellHeight;
  expect([actual.width, actual.height]).toEqual([width, height]);
  const expected = new Uint8Array(width * height * 4).fill(255);
  for (let i = 0; i < count; i++) {
    const left = (i % columns) * cellWidth + (cellWidth - 2) / 2;
    const top = Math.floor(i / columns) * cellHeight + (cellHeight - 2) / 2;
    for (let y = top; y < top + 2; y++) for (let x = left; x < left + 2; x++) expected.set([255, 0, 0, 255], (y * width + x) * 4);
  }
  expect(Buffer.from(actual.data).equals(expected)).toBe(true);
  if (nativeAvailable) {
    const input = `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    const reference = spawnSync("magick", ["montage", "-font", font, ...options, ...Array<string>(count).fill(input), "png:-"]);
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    expect(Buffer.from(actual.data).equals(native.data)).toBe(true);
  }
});
