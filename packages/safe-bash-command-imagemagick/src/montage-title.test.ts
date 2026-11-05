import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMontageCli, runMontageCliSync } from "./index.js";

const nativeAvailable = spawnSync("magick", ["-version"]).status === 0;
const font = existsSync("/System/Library/Fonts/Supplemental/Arial.ttf")
  ? "/System/Library/Fonts/Supplemental/Arial.ttf" : "DejaVu-Sans";

for (const mode of ["buffered", "retained", "sync"] as const)
it.each([
  { title: "HELLO", geometry: "40x20+2+2", pointsize: 12, width: 44, height: 56 },
  { title: "HELLO\nWORLD", geometry: "160x20+2+2", pointsize: 18, width: 164, height: 112 },
  { title: "HELLO", geometry: "+0+0", pointsize: 12, width: 20, height: 38 },
  { title: "", geometry: "40x20+2+2", pointsize: 12, width: 44, height: 56 },
])(`renders montage title via ${mode}: $title $geometry`, async ({ title, geometry, pointsize, width, height }) => {
  const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).png().toBuffer();
  const files = new Map([["input.png", bytes]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  const options = ["-tile", "1x1", "-geometry", geometry, "-pointsize", String(pointsize), "-fill", "blue", "-title", title];
  const args = [...options, "input.png", "png:-"];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const image = decodeImage(result.stdoutBytes!);
  expect([image.width, image.height]).toEqual([width, height]);
  const titleHeight = height - (geometry === "+0+0" ? 10 : 24);
  const ink = (im: typeof image) => {
    let count = 0;
    for (let y = 0; y < titleHeight; y++) for (let x = 0; x < im.width; x++) {
      const offset = (y * im.width + x) * 4;
      if (im.data[offset]! < 200 && im.data[offset + 1]! < 200 && im.data[offset + 2]! > 200) count++;
    }
    return count;
  };
  if (title) expect(ink(image)).toBeGreaterThan(10);
  if (nativeAvailable) {
    const reference = spawnSync("magick", ["montage", "-font", font, ...options,
      `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, "png:-"]);
    expect(reference.status, reference.stderr.toString()).toBe(0);
    const native = decodeImage(reference.stdout);
    expect([image.width, image.height]).toEqual([native.width, native.height]);
    if (title) {
      expect(ink(native)).toBeGreaterThan(10);
      // Compare title coverage while allowing the bundled glyphs to differ from host fonts.
      expect(ink(image) / ink(native)).toBeGreaterThan(0.5);
      expect(ink(image) / ink(native)).toBeLessThan(2);
    }
    // Text uses the portable SVG renderer; the tile below it must remain identical.
    expect(image.data.slice(titleHeight * width * 4)).toEqual(native.data.slice(titleHeight * width * 4));
  }
});

it("clears a previous title with +title", async () => {
  const files = new Map<string, Uint8Array>();
  const options = ["-size", "20x10", "xc:red", "-tile", "1x1", "-geometry", "40x20+2+2"];
  const plain = await runMontageCli([...options, "png:-"], files);
  const cleared = await runMontageCli([...options, "-title", "HELLO", "+title", "png:-"], files);
  expect(cleared).toEqual(plain);
});
