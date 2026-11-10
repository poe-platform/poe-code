import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  it(`formats quantum medians in identify and info (retained=${retained})`, async () => {
    for (const test of [
      { samples: [65535, 0, 0, 65535, 0, 0, 65535, 0, 0, 0, 0, 65535, 0, 65535, 0], median: "21845", red: "65535" },
      { samples: Array.from({ length: 5 }, () => [65535, 0, 0]).flat(), median: "21845", red: "65535" },
      { samples: [30001, 30000, 30011, 30009, 30000, 30011], median: "30004", red: "30001" }
    ]) {
      const samples = test.samples.flatMap((value, index) => index % 3 === 2 ? [value, 65535] : [value]);
      const bytes = encodeImage({ width: samples.length / 4, height: 1, data: Uint8Array.from(samples, v => Math.round(v / 257)), data16: Uint16Array.from(samples), format: "png", density: 72, space: "srgb", channels: 3, hasAlpha: false, depth: "ushort" }, { format: "png" }).data;
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", bytes);
      const input = retained ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", bytes]]);
      expect(await runMagickCli(["identify", "-format", "%[median]", "/input.png"], input))
        .toEqual({ exitCode: 0, stdout: test.median, stderr: "" });
      for (const selection of [[], ["-channel", "R"], ["-channel", "R", "+channel"]]) {
        expect(await runMagickCli(["/input.png", ...selection, "-format", "%[median]|%[fx:median.r]", "info:"], input))
          .toEqual({ exitCode: 0, stdout: `${selection.length === 2 ? test.red : test.median}|${Number((Number(test.red) / 65535).toFixed(6))}`, stderr: "" });
      }
    }
  });
}
