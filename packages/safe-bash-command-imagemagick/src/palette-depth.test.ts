import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  for (const variant of ["near256", "near257", "alpha257", "far257"] as const) {
    it(`classifies full-precision colors (${variant}, retained=${retained})`, async () => {
      const width = variant === "near256" ? 256 : 257;
      const samples = Uint16Array.from(Array.from({ length: width }, (_, i) =>
        variant === "alpha257" ? [1000, 18000, 61000, 30000 + i] :
          variant === "far257" ? [(i % 256) * 257, 18000 + Math.floor(i / 256) * 257, 61000, 65535] :
            [1000 + i, 18000, 61000, 65535]).flat());
      const bytes = encodeImage({ width, height: 1,
        data: Uint8Array.from(samples, value => Math.round(value / 257)), data16: samples,
        format: "png", density: 72, space: "srgb", channels: 4, hasAlpha: true, depth: "ushort"
      }, { format: "png" }).data;
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", bytes);
      const input = retained ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", bytes]]);
      const expected = `${width}|${width === 256 ? "PaletteAlpha" : "TrueColorAlpha"}|16|16`;
      // Type must also be correct without asking for the unbounded color count.
      for (const countColors of [false, true]) {
        const format = `${countColors ? "%k|" : ""}%[type]|%z|%[bit-depth]`;
        const stdout = countColors ? expected : expected.slice(expected.indexOf("|") + 1);
        expect(await runMagickCli(["identify", "-format", format, "/input.png"], input))
          .toEqual({ exitCode: 0, stdout, stderr: "" });
        expect(await runMagickCli(["/input.png", "-format", format, "info:"], input))
          .toEqual({ exitCode: 0, stdout, stderr: "" });
      }
      expect(await fs.readFile("/input.png")).toEqual(bytes);
    });
  }
}
