import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

it.each([false, true])("formats quantum extrema separately from normalized FX extrema (retained=%s)", async retained => {
  const solid = encodeImage({
    width: 2, height: 1, data: Uint8Array.of(64, 96, 128, 255, 64, 96, 128, 255),
    format: "png", density: 72, space: "srgb", channels: 3, hasAlpha: false, depth: "uchar"
  }, { format: "png" }).data;
  for (const { path, bytes, expected } of [
    {
      path: "/tile.ppm",
      bytes: new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n"),
      expected: "0|65535|0|1"
    },
    { path: "/solid.png", bytes: solid, expected: "16448|32896|0.25098|0.501961" }
  ]) {
    const fs = new MemoryFileSystem();
    await fs.writeFile(path, bytes);
    const input = retained ? { filesystem: fs, cwd: "/" } : new Map([[path, bytes]]);
    for (const format of ["%[minima]|%[maxima]|%[fx:minima]|%[fx:maxima]", "%[MINIMA]|%[MAXIMA]|%[fx:minima]|%[fx:maxima]"]) {
      expect(await runMagickCli(["identify", "-format", format, path], input))
        .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
      expect(await runMagickCli([path, "-format", format, "info:"], input))
        .toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    }
  }
});
