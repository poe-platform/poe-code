import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  it(`formats normalized channel and composite entropy (retained=${retained})`, async () => {
    // ImageMagick Q16 normalizes each channel by its number of distinct values.
    const cases = [
      { samples: [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255], alpha: false, depth: 8, expected: "0.804936", channel: "R", selected: "0.970951" },
      { samples: [255, 0, 0, 255, 255, 0, 0, 255], alpha: false, depth: 8, expected: "0", channel: "R", selected: "0" },
      { samples: [0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255], alpha: false, depth: 8, expected: "1", channel: "RGB", selected: "1" },
      { samples: [255, 0, 0, 0, 255, 0, 0, 255], alpha: true, depth: 8, expected: "0.25", channel: "A", selected: "1" },
      { samples: [30000, 30000, 30000, 65535, 30001, 30000, 30000, 65535, 30002, 30000, 30000, 65535], alpha: false, depth: 16, expected: "0.333333", channel: "R", selected: "1" }
    ];
    for (const test of cases) {
      const bytes = encodeImage({ width: test.samples.length / 4, height: 1, data: Uint8Array.from(test.samples, v => test.depth === 16 ? Math.round(v / 257) : v), ...(test.depth === 16 ? { data16: Uint16Array.from(test.samples) } : {}), format: "png", density: 72, space: "srgb", channels: test.alpha ? 4 : 3, hasAlpha: test.alpha, depth: test.depth === 16 ? "ushort" : "uchar" }, { format: "png" }).data;
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", bytes);
      const input = retained ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", bytes]]);
      expect(await runMagickCli(["identify", "-format", "%[entropy]", "/input.png"], input)).toEqual({ exitCode: 0, stdout: test.expected, stderr: "" });
      for (const selection of [[], ["-channel", test.channel], ["-channel", test.channel, "+channel"]]) {
        expect(await runMagickCli(["/input.png", ...selection, "-format", "%[entropy]", "info:"], input)).toEqual({ exitCode: 0, stdout: (selection.length === 2 ? test.selected : test.expected), stderr: "" });
      }
    }
  });
}
