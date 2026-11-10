import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  it(`honors selected channels and resets formatted statistics (retained=${retained})`, async () => {
    const cases = [
      { samples: [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255], alpha: false, depth: 8, channel: "R", expected: "39321|35895|0|65535", baseline: "21845|31503.8|0|65535" },
      { samples: [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 128, 0, 0, 0, 0], alpha: true, depth: 8, channel: "A", expected: "45900.2|29293.8|0|65535", baseline: "24582|23624.2|0|65535" },
      { samples: [30001, 30000, 30011, 65535, 30009, 30000, 30011, 65535], alpha: false, depth: 16, channel: "R", expected: "30005|5.65685|30001|30009", baseline: "30005.3|1.88562|30000|30011" }
    ];
    for (const test of cases) {
      const bytes = encodeImage({ width: test.samples.length / 4, height: 1, data: Uint8Array.from(test.samples, v => test.depth === 16 ? Math.round(v / 257) : v), ...(test.depth === 16 ? { data16: Uint16Array.from(test.samples) } : {}), format: "png", density: 72, space: "srgb", channels: test.alpha ? 4 : 3, hasAlpha: test.alpha, depth: test.depth === 16 ? "ushort" : "uchar" }, { format: "png" }).data;
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", bytes);
      const input = retained ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", bytes]]);
      for (const selection of [[], ["-channel", test.channel], ["-channel", test.channel, "+channel"]]) {
        for (const extrema of ["%[min]|%[max]", "%[minima]|%[maxima]"]) {
          expect(await runMagickCli(["/input.png", ...selection, "-format", `%[mean]|%[standard-deviation]|${extrema}`, "info:"], input)).toEqual({ exitCode: 0, stdout: (selection.length === 2 ? test.expected : test.baseline), stderr: "" });
        }
      }
    }
  });
}
