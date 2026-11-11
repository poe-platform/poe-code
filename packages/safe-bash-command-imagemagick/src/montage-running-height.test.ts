import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const tiles = {
  a: { width: 3, height: 2, color: [255, 0, 0] },
  b: { width: 2, height: 4, color: [0, 255, 0] },
  c: { width: 1, height: 3, color: [0, 0, 255] }
} as const;

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const input of ["ppm", "png", "png:"] as const)
it.each([
  { order: "ba", tile: "2x1", gravity: "South", tops: [0, 2], width: 5, height: 4 },
  { order: "ba", tile: "2x1", gravity: "Center", tops: [0, 1], width: 5, height: 4 },
  { order: "ba", tile: "2x1", gravity: "North", tops: [0, 0], width: 5, height: 4 },
  { order: "ab", tile: "2x1", gravity: "South", tops: [0, 0], width: 5, height: 4 },
  { order: "abc", tile: "3x1", gravity: "South", tops: [0, 0, 1], width: 6, height: 4 },
  { order: "baab", tile: "2x2", gravity: "South", tops: [0, 2, 4, 4], width: 5, height: 8 },
  { order: "baab", tile: "2x1", gravity: "South", tops: [0, 2, 0, 0], width: 5, height: 4 },
])(`${mode}, ${input}: aligns offset-only tiles in input order: $order $tile $gravity`, async ({ order, tile, gravity, tops, width, height }) => {
  const files = new Map<string, Uint8Array>();
  const fs = new MemoryFileSystem();
  for (const [name, image] of Object.entries(tiles)) {
    const pixels = Array.from({ length: image.width * image.height }, () => [...image.color, 255]).flat();
    const bytes = input === "ppm"
      ? Buffer.concat([Buffer.from(`P6\n${image.width} ${image.height}\n255\n`), Buffer.from(Array.from({ length: image.width * image.height }, () => image.color).flat())])
      : encodeImage({ ...image, data: new Uint8Array(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
    files.set(`/${name}`, bytes);
    await fs.writeFile(`/${name}`, bytes);
  }
  const args = [...Array.from(order, name => `${input === "png:" ? "png:" : ""}/${name}`), "-tile", tile, "-geometry", "+0+0", "-gravity", gravity, "-depth", "8", "ppm:-"];
  let output: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }, registerCleanup() {}
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    output = Buffer.concat(chunks);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = result.stdoutBytes!;
  }
  // Native ImageMagick 7.1.2-35: each tile uses the row height reached so far.
  const [cols, rows] = tile.split("x").map(Number);
  const pageSize = cols! * rows!;
  const pages: Buffer[] = [];
  for (let start = 0; start < order.length; start += pageSize) {
    const pixels = new Uint8Array(width * height * 3).fill(255);
    let left = 0;
    for (let i = start; i < Math.min(order.length, start + pageSize); i++) {
      if ((i - start) % cols! === 0) left = 0;
      const image = tiles[order[i] as keyof typeof tiles];
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++)
        pixels.set(image.color, ((tops[i]! + y) * width + left + x) * 3);
      left += image.width;
    }
    pages.push(Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
  }
  expect(Buffer.from(output)).toEqual(Buffer.concat(pages));
});
