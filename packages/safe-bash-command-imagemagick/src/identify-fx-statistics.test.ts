import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runIdentifyCli, runMagickCli } from "./index.js";

it.each([false, true])("evaluates image-wide FX statistics with retained input=%s", async (retained) => {
  const bytes = await sharp(new Uint8Array([0, 0, 0, 128, 128, 128, 255, 255, 255]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", bytes);
  const result = await runIdentifyCli(["-format", "%w %h %[fx:mean] %[fx:standard_deviation] %[fx:mean.r] %[fx:2*mean.g]", "/input"], retained ? { filesystem: fs, cwd: "/" } : new Map([["/input", bytes]]));
  expect(result).toEqual({ exitCode: 0, stdout: "3 1 0.500654 0.500001 0.500654 1.001307", stderr: "" });
});

it.each([false, true])("distinguishes overall and channel statistics with retained input=%s", async (retained) => {
  const bytes = await sharp(new Uint8Array([0, 128, 255, 255, 128, 255]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", bytes);
  const result = await runIdentifyCli(["-format", "%[fx:mean] %[fx:mean.r] %[fx:mean.g] %[fx:mean.b] %[fx:standard_deviation] %[fx:standard_deviation.r] %[fx:standard_deviation.g]", "/input"], retained ? { filesystem: fs, cwd: "/" } : new Map([["/input", bytes]]));
  expect(result).toEqual({ exitCode: 0, stdout: "0.66732 0.5 0.501961 1 0.235702 0.707107 0", stderr: "" });
});

it("evaluates FX statistics through magick identify stdin", async () => {
  const bytes = await sharp(new Uint8Array([0, 0, 0, 128, 128, 128, 255, 255, 255]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
  expect(await runMagickCli(["identify", "-format", "%w %h %[fx:mean] %[fx:standard_deviation]", "png:-"], new Map(), bytes))
    .toEqual({ exitCode: 0, stdout: "3 1 0.500654 0.500001", stderr: "" });
});

it.each([false, true])("handles a single pixel and alpha statistics with retained input=%s", async (retained) => {
  const bytes = await sharp(new Uint8Array([255, 0, 0, 128]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", bytes);
  expect(await runIdentifyCli(["-format", "%[opaque] %[fx:mean] %[fx:mean.a] %[fx:standard_deviation] %[fx:standard_deviation.a]", "/input"], retained ? { filesystem: fs, cwd: "/" } : new Map([["/input", bytes]])))
    .toEqual({ exitCode: 0, stdout: "false 0.37549 0.501961 0 0", stderr: "" });
});
