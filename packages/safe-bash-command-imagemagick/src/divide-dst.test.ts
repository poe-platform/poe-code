import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompositeCli, runCompositeCliSync, runMagickCli } from "./index.js";

const native = spawnSync("magick", ["-version"]);
for (const entry of ["map", "sync", "filesystem", "magick"] as const) {
  // ImageMagick 7.1.2-32 references; 7.1.2-31 omitted alpha normalization.
  it.each([
    { sourceAlpha: 128, destinationAlpha: 102, expected: [255, 128, 188, 179] },
    { sourceAlpha: 0, destinationAlpha: 102, expected: [30, 100, 220, 102] },
    { sourceAlpha: 128, destinationAlpha: 0, expected: [255, 255, 255, 128] },
    { sourceAlpha: 255, destinationAlpha: 0, expected: [200, 20, 50, 255] },
    { sourceAlpha: 0, destinationAlpha: 0, expected: [255, 255, 255, 0] },
  ])(`DivideDst matches native via ${entry} alpha=$sourceAlpha/$destinationAlpha`, async ({ sourceAlpha, destinationAlpha, expected }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    for (const [path, pixels] of [
      ["/overlay.png", [200, 20, 50, sourceAlpha]],
      ["/base.png", [30, 100, 220, destinationAlpha]],
    ] as const) {
      const bytes = await sharp(new Uint8Array(pixels), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
      files.set(path, bytes);
      await fs.writeFile(path, bytes);
    }
    const args = ["-compose", "DivideDst", "/overlay.png", "/base.png", "/out.png"];
    const result = entry === "sync" ? runCompositeCliSync(args, files)
      : entry === "magick" ? await runMagickCli(["/base.png", "/overlay.png", "-compose", "DivideDst", "-composite", "/out.png"], { filesystem: fs, cwd: "/" })
      : await runCompositeCli(args, entry === "filesystem" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(entry === "filesystem" || entry === "magick" ? await fs.readFile("/out.png") : files.get("/out.png")!).data]).toEqual(expected);
  });
}

it.skipIf(native.error !== undefined)("DivideDst matches native opaque pixels and zero divisors", async () => {
  const source: number[] = [], destination: number[] = [];
  for (const value of [0, 1, 128, 255]) {
    const sa = 255, da = 255;
    source.push(200, value, 50, sa, 0, 20, 255, sa);
    destination.push(30, 100, 220, da, 0, 0, 255, da);
  }
  const overlay = await sharp(new Uint8Array(source), { raw: { width: 8, height: 1, channels: 4 } }).png().toBuffer();
  const base = await sharp(new Uint8Array(destination), { raw: { width: 8, height: 1, channels: 4 } }).png().toBuffer();
  const expected = spawnSync("magick", ["composite", "-compose", "DivideDst", ...[overlay, base].map(bytes => `inline:data:image/png;base64,${Buffer.from(bytes).toString("base64")}`), "png:-"]);
  expect(expected.status).toBe(0);
  const files = new Map([["overlay.png", overlay], ["base.png", base]]);
  expect((await runCompositeCli(["-compose", "DivideDst", "overlay.png", "base.png", "out.png"], files)).exitCode).toBe(0);
  expect(decodeImage(files.get("out.png")!).data).toEqual(decodeImage(expected.stdout).data);
});
