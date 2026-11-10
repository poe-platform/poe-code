import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  for (const identify of [false, true]) {
    it(`keeps extrema and lower medians across read chunks (retained=${retained}, identify=${identify})`, async () => {
      const pixels = new Uint8Array(2052 * 3).fill(128);
      pixels.fill(64, 0, 1025 * 3);
      pixels.fill(0, 2049 * 3, 2050 * 3);
      pixels.fill(255, 2051 * 3);
      const bytes = await sharp(pixels, { raw: { width: 2052, height: 1, channels: 3 } }).png().toBuffer();
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", bytes);
      const input = retained ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", bytes]]);
      const format = "%[fx:minima.r]|%[fx:maxima.r]|%[fx:median.r]";
      const args = identify ? ["identify", "-format", format, "/input.png"] : ["/input.png", "-format", format, "info:"];
      expect(await runMagickCli(args, input)).toEqual({ exitCode: 0, stdout: "0|1|0.25098", stderr: "" });
    });
    it(`computes channel extrema and medians across every pixel (retained=${retained}, identify=${identify})`, async () => {
      for (const order of [[0, 0, 0, 1, 2], [1, 2, 0, 0, 0]]) {
        const colors = [[255, 0, 0], [0, 0, 255], [0, 255, 0]];
        const bytes = await sharp(new Uint8Array(order.flatMap(index => colors[index]!)), { raw: { width: 5, height: 1, channels: 3 } }).png().toBuffer();
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.png", bytes);
        const input = retained ? { filesystem: fs, cwd: "/" } : new Map([["/input.png", bytes]]);
        const format = ["r", "g", "b"].flatMap(channel => ["minima", "maxima", "median", "mean"].map(stat => `%[fx:${stat}.${channel}]`)).join("|");
        const args = identify ? ["identify", "-format", format, "/input.png"] : ["/input.png", "-format", format, "info:"];
        expect(await runMagickCli(args, input)).toEqual({ exitCode: 0, stdout: "0|1|1|0.6|0|1|0|0.2|0|1|0|0.2", stderr: "" });
      }
    });
  }
}
