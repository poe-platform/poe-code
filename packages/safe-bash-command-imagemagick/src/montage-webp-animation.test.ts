import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import sharp from "sharp";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const lossless of [false, true])
for (const destination of ["webp:-", "/sheet.webp"])
it.each([
  { tile: "1x1", options: [], pages: 2 },
  { tile: "1x1", options: ["-adjoin"], pages: 2 },
  { tile: "2x1", options: [], pages: 1 }
])(`encodes montage WebP pages via ${mode}, lossless=${lossless}, ${destination}: $tile $options`, async ({ tile, options, pages }) => {
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  const args = ["xc:red", "xc:blue", "-tile", tile, "-geometry", "+0+0", ...options,
    ...(lossless ? ["-quality", "100"] : []), destination];
  let bytes: Uint8Array;
  if (mode === "magick" || mode === "montage") {
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute({
      command: mode, args: mode === "magick" ? ["montage", ...args] : args,
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    bytes = destination === "webp:-" ? Buffer.concat(chunks) : await fs.readFile(destination);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    bytes = destination === "webp:-" ? result.stdoutBytes!
      : mode === "retained" ? await fs.readFile(destination) : files.get(destination)!;
  }
  expect(bytes).toBeDefined();
  const buffer = Buffer.from(bytes);
  expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buffer.readUInt32LE(4) + 8).toBe(bytes.length);
  const chunks: string[] = [];
  for (let offset = 12; offset < bytes.length;) {
    chunks.push(buffer.toString("ascii", offset, offset + 4));
    const length = buffer.readUInt32LE(offset + 4);
    offset += 8 + length + (length & 1);
  }
  expect(chunks).toEqual(pages === 2 ? ["VP8X", "ANIM", "ANMF", "ANMF"] : [lossless ? "VP8L" : "VP8 "]);
  if (pages === 2) {
    expect(readImageMetadata(bytes)).toMatchObject({ pages: 2, delay: [100, 100], loop: 0 });
    // Native ImageMagick 7.1.2-35/libwebp: separate red and blue display frames.
    const pixels = await sharp(bytes, { animated: true }).ensureAlpha().raw().toBuffer();
    const expected = lossless ? [255, 0, 0, 255, 0, 0, 255, 255] : [255, 0, 2, 255, 2, 0, 255, 255];
    expect(pixels.length).toBe(expected.length);
    // The lossy encoder may differ from libwebp by two RGB levels.
    for (const [channel, value] of expected.entries())
      expect(Math.abs(pixels[channel]! - value)).toBeLessThanOrEqual(lossless || channel % 4 === 3 ? 0 : 2);
  } else {
    const image = decodeImage(bytes);
    expect([image.width, image.height]).toEqual([2, 1]);
    if (lossless) expect([...image.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  }
});

for (const mode of ["buffered", "retained", "sync"] as const)
it.each([
  { options: ["+adjoin"], destination: "/sheet.webp" },
  { options: [], destination: "/sheet-%d.webp" }
])(`keeps explicitly separate WebP pages via ${mode}: $options $destination`, async ({ options, destination }) => {
  const files = new Map<string, Uint8Array>();
  const filesystem = new MemoryFileSystem();
  const args = ["xc:red", "xc:blue", "-tile", "1x1", "-geometry", "+0+0", "-quality", "100", ...options, destination];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  for (const [page, color] of [[255, 0, 0, 255], [0, 0, 255, 255]].entries()) {
    const path = `/sheet-${page}.webp`;
    const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
    expect([...decodeImage(bytes).data]).toEqual(color);
  }
});
