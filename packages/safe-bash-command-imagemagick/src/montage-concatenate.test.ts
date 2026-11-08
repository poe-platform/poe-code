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
  { tile: "2x1", extra: [], count: 2, width: 6, height: 2, blueY: 0 },
  { tile: "2x2", extra: [], count: 3, width: 6, height: 5, blueY: 0 },
  { tile: "2x2", extra: ["-gravity", "SouthEast"], count: 3, width: 6, height: 5, blueY: 1 },
  { tile: "2x1", extra: ["-thumbnail", "100%"], count: 2, width: 6, height: 2, blueY: 0 },
])(`concatenates unequal tiles via ${execution}: $tile $extra`, async ({ tile, extra, count, width, height, blueY }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const [name, w, h, background] of [["red.png", 2, 2, "red"], ["blue.png", 4, 1, "blue"], ["green.png", 1, 3, "lime"]].slice(0, count) as [string, number, number, string][]) {
    const bytes = await sharp({ create: { width: w, height: h, channels: 3, background } }).png().toBuffer();
    files.set(name, bytes);
    await fs.writeFile("/" + name, bytes);
  }
  const options = ["-tile", tile, "-geometry", "4x4+2+2", "-mode", "Concatenate", ...extra];
  const args = [...options, ...files.keys(), "png:-"];
  const result = execution === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, execution === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  expect([actual.width, actual.height]).toEqual([width, height]);
  const expected = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) expected.set([255, 0, 0, 255], (y * width + x) * 4);
  for (let x = 2; x < 6; x++) expected.set([0, 0, 255, 255], (blueY * width + x) * 4);
  if (count === 3) for (let y = 2; y < 5; y++) expected.set([0, 255, 0, 255], y * width * 4);
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

it("allows geometry after Concatenate to restore fixed cells", async () => {
  const args = ["-tile", "2x1", "-mode", "Concatenate", "-geometry", "4x4+2+2",
    "-size", "2x2", "xc:red", "-size", "4x1", "xc:blue", "png:-"];
  // Use encoded inputs so both implementations receive the same images.
  const files = new Map<string, Uint8Array>();
  for (const [name, width, height, background] of [["red.png", 2, 2, "red"], ["blue.png", 4, 1, "blue"]] as const)
    files.set(name, await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer());
  const result = await runMontageCli([...args.slice(0, 6), ...files.keys(), "png:-"], files);
  expect(result.exitCode).toBe(0);
  const actual = decodeImage(result.stdoutBytes!);
  expect([actual.width, actual.height]).toEqual([16, 8]);
  if (nativeAvailable) {
    const reference = spawnSync("magick", ["montage", "-font", font, ...args.slice(0, 6),
      ...Array.from(files.values(), bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
    expect(reference.status, reference.stderr.toString()).toBe(0);
    expect(Buffer.from(actual.data).equals(decodeImage(reference.stdout).data)).toBe(true);
  }
});

for (const execution of ["buffered", "retained", "sync"] as const)
it.each([
  { border: ["-mode", "Concatenate", "-border", "1"], width: 10, height: 4, inset: 1 },
  { border: ["-mode", "Concatenate", "-border", "2"], width: 14, height: 6, inset: 2 },
  { border: ["-border", "1", "-mode", "Concatenate"], width: 6, height: 2, inset: 0 },
  { border: ["-mode", "Concatenate", "-border", "0"], width: 6, height: 2, inset: 0 },
])(`places Concatenate borders via ${execution}: $border`, async ({ border, width, height, inset }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const [name, w, h, background] of [["red.png", 2, 2, "red"], ["blue.png", 4, 1, "blue"]] as const) {
    const bytes = await sharp({ create: { width: w, height: h, channels: 3, background } }).png().toBuffer();
    files.set(name, bytes);
    await fs.writeFile("/" + name, bytes);
  }
  const options = ["-tile", "2x1", ...border, "-bordercolor", "yellow"];
  const args = [...options, ...files.keys(), "png:-"];
  const result = execution === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, execution === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const actual = decodeImage(result.stdoutBytes!);
  expect([actual.width, actual.height]).toEqual([width, height]);
  const expected = new Uint8Array(width * height * 4).fill(255);
  let left = inset;
  for (const [w, h, color] of [[2, 2, [255, 0, 0, 255]], [4, 1, [0, 0, 255, 255]]] as const) {
    for (let y = inset; y < Math.min(height, h + inset * 3); y++) {
      for (let x = left; x < Math.min(width, left + w + inset * 2); x++) {
        const interior = x >= left + inset && x < left + inset + w && y >= inset * 2 && y < inset * 2 + h;
        expected.set(interior ? color : [255, 255, 0, 255], (y * width + x) * 4);
      }
    }
    left += w + inset * 2;
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
