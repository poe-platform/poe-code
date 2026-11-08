import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runCompositeCliSync, runMagickCli } from "./index.js";

// ImageMagick 7.1.2-32 DivideSrc references. Earlier versions omit alpha
// normalization, so their partially transparent output is not the reference.
for (const entry of ["map", "sync", "filesystem", "magick"] as const) {
  it.each([
    { source: [200, 20, 50, 128], base: [30, 100, 220, 102], expected: [138, 255, 255, 179] },
    { source: [200, 20, 50, 255], base: [30, 100, 220, 255], expected: [38, 255, 255, 255] },
    { source: [0, 0, 255, 255], base: [100, 0, 0, 255], expected: [255, 0, 0, 255] },
    { source: [200, 20, 50, 0], base: [30, 100, 220, 102], expected: [255, 255, 255, 102] },
    { source: [200, 20, 50, 128], base: [30, 100, 220, 0], expected: [255, 255, 255, 128] },
  ])(`DivideSrc ${entry} matches native: $source / $base`, async ({ source, base, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    for (const [path, pixels] of [["/overlay.png", source], ["/base.png", base]] as const) {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["-compose", "DivideSrc", "/overlay.png", "/base.png", "/out.png"];
    const result = entry === "sync" ? runCompositeCliSync(args, files)
      : entry === "magick" ? await runMagickCli(["/base.png", "/overlay.png", "-compose", "DivideSrc", "-composite", "/out.png"], files)
      : await runCompositeCli(args, entry === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(entry === "filesystem" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect(Array.from(output.data)).toEqual(expected);
  });
}

const native = spawnSync("magick", ["-version"]);
it.skipIf(native.status !== 0)("DivideSrc opaque pixels match native ImageMagick", async () => {
  const source = await sharp(new Uint8Array([200, 20, 50, 255, 0, 0, 255, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  const base = await sharp(new Uint8Array([30, 100, 220, 255, 100, 0, 0, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  const reference = spawnSync("magick", ["composite", "-compose", "DivideSrc", ...[source, base].map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
  expect(reference.status).toBe(0);
  const files = new Map([["source.png", source], ["base.png", base]]);
  expect((await runCompositeCli(["-compose", "DivideSrc", "source.png", "base.png", "out.png"], files)).exitCode).toBe(0);
  expect(decodeImage(files.get("out.png")!).data).toEqual(decodeImage(reference.stdout).data);
});
