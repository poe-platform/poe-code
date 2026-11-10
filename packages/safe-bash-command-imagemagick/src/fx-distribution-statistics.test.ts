import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference values for the six-pixel PPM below.
const tile = new TextEncoder().encode("P3\n3 2\n255\n255 0 0  0 255 0  0 0 255\n0 0 0  255 255 255  128 64 32\n");
const solid = encodeImage({ width: 2, height: 1, data: Uint8Array.from([64, 96, 128, 255, 64, 96, 128, 255]), format: "png", density: 72, space: "srgb", channels: 3, hasAlpha: false, depth: "uchar" }, { format: "png" }).data;

for (const retained of [false, true]) for (const identify of [false, true]) {
  for (const [name, bytes, expected, red] of [
    ["tile.ppm", tile, "-2.00662|0.407245", "-2.08211|0.251593"],
    ["solid.png", solid, "0|0", "0|0"]
  ] as const) {
    it(`evaluates image distribution FX for ${name} (retained=${retained}, identify=${identify})`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile(`/${name}`, bytes);
      const input = retained ? { filesystem: fs, cwd: "/" } : new Map([[`/${name}`, bytes]]);
      for (const [format, output] of [
        ["%[fx:kurtosis]|%[fx:skewness]", expected],
        ["%[fx:kurtosis.r]|%[fx:skewness.r]", red],
        ["%[kurtosis]|%[skewness]|%[fx:kurtosis]|%[fx:skewness]", `${expected}|${expected}`]
      ] as const) {
        const args = identify ? ["identify", "-format", format, `/${name}`] : [`/${name}`, "-format", format, "info:"];
        expect(await runMagickCli(args, input)).toEqual({ exitCode: 0, stdout: output, stderr: "" });
      }
    });
  }
}
