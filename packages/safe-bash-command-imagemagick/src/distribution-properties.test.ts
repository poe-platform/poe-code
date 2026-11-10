import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) for (const depth of [8, 16]) {
  it(`formats sample-normalized skewness and excess kurtosis (retained=${retained}, depth=${depth})`, async () => {
    for (const test of [
      { rgb: [255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 255, 0], expected: "0.618169|-1.36444", red: "-0.292119|-2.25333" },
      { rgb: Array.from({ length: 5 }, () => [255, 0, 0]).flat(), expected: "0|0", red: "0|0" },
      { rgb: [255, 0, 0], expected: "0|0", red: "0|0" },
      { rgb: [0, 0, 0, 255, 255, 255], expected: "0|-2.75", red: "0|-2.75" }
    ]) {
      const samples = test.rgb.flatMap((value, index) => index % 3 === 2 ? [value, 255] : [value]);
      const bytes = encodeImage({ width: samples.length / 4, height: 1, data: Uint8Array.from(samples), ...(depth === 16 ? { data16: Uint16Array.from(samples, value => 30000 + value * 2) } : {}), format: "png", density: 72, space: "srgb", channels: 3, hasAlpha: false, depth: depth === 16 ? "ushort" : "uchar" }, { format: "png" }).data;
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", bytes);
      const input = retained ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", bytes]]);
      expect(await runMagickCli(["identify", "-format", "%[skewness]|%[kurtosis]|%[fx:skewness]|%[fx:kurtosis]|%[fx:skewness.r]|%[fx:kurtosis.r]", "/input.png"], input))
        .toEqual({ exitCode: 0, stdout: `${test.expected}|${test.expected}|${test.red}`, stderr: "" });
      for (const selection of [[], ["-channel", "R"], ["-channel", "R", "+channel"]]) {
        expect(await runMagickCli(["/input.png", ...selection, "-format", "%[skewness]|%[kurtosis]", "info:"], input))
          .toEqual({ exitCode: 0, stdout: `${selection.length === 2 ? test.red : test.expected}`, stderr: "" });
      }
    }
  });
}

it("averages alpha moments with RGB and honors alpha selection", async () => {
  const bytes = encodeImage({ width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 255]), format: "png", density: 72, space: "srgb", channels: 4, hasAlpha: true, depth: "uchar" }, { format: "png" }).data;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.png", bytes);
  for (const input of [new Map([["/input.png", bytes]]), { filesystem: fs, cwd: "/" }]) {
    expect(await runMagickCli(["identify", "-format", "%[fx:kurtosis]|%[fx:kurtosis.a]|%[fx:kurtosis.g]|%[fx:skewness.a]", "/input.png"], input))
      .toEqual({ exitCode: 0, stdout: "-0.6875|-2.75|0|0", stderr: "" });
    for (const selection of [[], ["-channel", "A"]]) {
      expect(await runMagickCli(["/input.png", ...selection, "-format", "%[skewness]|%[kurtosis]", "info:"], input))
        .toEqual({ exitCode: 0, stdout: selection.length ? "0|-2.75" : "0|-0.6875", stderr: "" });
    }
  }
});
