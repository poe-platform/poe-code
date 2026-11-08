import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMontageCli, runMontageCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
const font = existsSync("/System/Library/Fonts/Supplemental/Arial.ttf")
  ? "/System/Library/Fonts/Supplemental/Arial.ttf" : "DejaVu-Sans";

for (const mode of ["buffered", "retained"] as const)
for (const geometry of ["2x2+1+1", "+1+1"])
it.each([
  { border: "#00ff00", pixel: [128, 127, 0, 255] },
  { border: "#00ff0080", pixel: [170, 85, 0, 192] },
  { border: undefined, pixel: [255, 0, 0, 128] },
])(`composites montage tiles over their border via ${mode} at ${geometry}: $border`, async ({ border, pixel }) => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 128 / 255 } } }).png().toBuffer();
  const files = new Map([["input.png", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const options = ["-background", "none", "-tile", "1x1", "-geometry", geometry,
    ...(border ? ["-border", "1", "-bordercolor", border] : [])];
  const result = await runMontageCli([...options, "input.png", "png:-"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  const size = border ? 6 : 4;
  expect([actual.width, actual.height]).toEqual([size, size]);
  expect(Array.from(actual.data.slice((2 * size + 2) * 4, (2 * size + 2) * 4 + 4))).toEqual(pixel);
  if (nativeAvailable) {
    const reference = spawnSync("magick", ["montage", "-font", font, ...options,
      `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, "png:-"]);
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    expect(Buffer.from(actual.data).equals(native.data)).toBe(true);
  }
});

for (const mode of ["buffered", "retained", "sync"] as const)
it.each([
  { scale: 1, geometry: ["-geometry", "+0+0"], width: 6, height: 2, red: [0, 0, 2, 2], blue: [2, 0, 4, 1] },
  { scale: 1, geometry: ["-geometry", "+1+1"], width: 10, height: 4, red: [1, 1, 2, 2], blue: [5, 1, 4, 1] },
  { scale: 1, geometry: ["-geometry", "+1+1", "-thumbnail", "100%"], width: 10, height: 4, red: [1, 1, 2, 2], blue: [5, 1, 4, 1] },
  { scale: 1, geometry: ["-geometry", "+2+2"], width: 14, height: 6, red: [2, 2, 2, 2], blue: [8, 2, 4, 1] },
  { scale: 1, geometry: ["-geometry", "4x4+0+0"], width: 8, height: 4, red: [0, 0, 4, 4], blue: [4, 1, 4, 1] },
  { scale: 1, geometry: ["-geometry", "4x4+1+1"], width: 12, height: 6, red: [1, 1, 4, 4], blue: [7, 2, 4, 1] },
  { scale: 1, geometry: [], width: 256, height: 126, red: [63, 62, 2, 2], blue: [190, 62, 4, 1] },
  { scale: 1, geometry: ["-geometry", "2x2+0+0"], width: 4, height: 2, red: [0, 0, 2, 2], blue: [2, 0, 2, 1] },
  { scale: 120, geometry: [], width: 256, height: 126, red: [4, 3, 120, 120], blue: [132, 48, 120, 30] },
])(`matches montage tile geometry via ${mode}: $geometry at scale $scale`, async ({ scale, geometry, width, height, red, blue }) => {
  const files = new Map<string, Uint8Array>();
  for (const [name, w, h, background] of [["red.png", 2, 2, "red"], ["blue.png", 4, 1, "blue"]] as const) {
    files.set(name, await sharp({ create: { width: w * scale, height: h * scale, channels: 3, background } }).png().toBuffer());
  }
  const fs = new MemoryFileSystem();
  for (const [name, bytes] of files) await fs.writeFile("/" + name, bytes);
  const options = ["-tile", "2x1", ...geometry];
  const args = [...options, ...files.keys(), "png:-"];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  expect([actual.width, actual.height]).toEqual([width, height]);
  const expected = new Uint8Array(width * height * 4).fill(255);
  for (const [rect, color] of [[red, [255, 0, 0, 255]], [blue, [0, 0, 255, 255]]] as const) {
    const [left, top, w, h] = rect as [number, number, number, number];
    for (let y = top; y < top + h; y++) for (let x = left; x < left + w; x++) expected.set(color, (y * width + x) * 4);
  }
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

for (const mode of ["buffered", "retained"] as const)
it.each([
  { options: ["-thumbnail", "4x4"], width: 128, height: 126, size: 4 },
  { options: ["-geometry", "120x120+4+3", "-thumbnail", "4x4"], width: 128, height: 126, size: 120 },
  { options: ["-thumbnail", "4x4", "-geometry", "120x120+4+3"], width: 128, height: 126, size: 120 },
  { options: ["-geometry", "+4+3", "-thumbnail", "4x4"], width: 12, height: 10, size: 4 },
])(`keeps thumbnail resizing separate from tile geometry via ${mode}: $options`, async ({ options, width, height, size }) => {
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["input.png", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const args = ["-tile", "1x1", ...options];
  const result = await runMontageCli([...args, "input.png", "png:-"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  expect([actual.width, actual.height]).toEqual([width, height]);
  let redPixels = 0;
  for (let i = 0; i < actual.data.length; i += 4) if (actual.data[i + 1] === 0) redPixels++;
  expect(redPixels).toBe(size * size);
  if (nativeAvailable) {
    const reference = spawnSync("magick", ["montage", "-font", font, ...args,
      `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, "png:-"]);
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([actual.width, actual.height]).toEqual([native.width, native.height]);
    expect(Buffer.from(actual.data).equals(native.data)).toBe(true);
  }
});

for (const mode of ["buffered", "retained", "sync"] as const)
it.each([
  { modifier: ">", left: 1, top: 1, width: 2, height: 1 },
  { modifier: "!", left: 0, top: 0, width: 4, height: 4 },
  { modifier: "", left: 0, top: 1, width: 4, height: 2 },
])(`preserves explicit tile resize modifiers via ${mode}: $modifier`, async ({ modifier, left, top, width, height }) => {
  const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["input.png", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const options = ["-geometry", "+0+0", "-geometry", `4x4+0+0${modifier}`];
  const args = [...options, "input.png", "png:-"];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  expect([actual.width, actual.height]).toEqual([4, 4]);
  const expected = new Uint8Array(4 * 4 * 4).fill(255);
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) expected.set([255, 0, 0, 255], (y * 4 + x) * 4);
  expect(Array.from(actual.data)).toEqual(Array.from(expected));
  if (nativeAvailable) {
    const reference = spawnSync("magick", ["montage", "-font", font, ...options,
      `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, "png:-"]);
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([native.width, native.height]).toEqual([4, 4]);
    expect(Array.from(native.data)).toEqual(Array.from(expected));
  }
});
