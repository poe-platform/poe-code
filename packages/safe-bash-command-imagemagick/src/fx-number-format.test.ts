import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

it.each([false, true])("formats FX with six significant digits with retained input=%s", async (retained) => {
  const bytes = await sharp(new Uint8Array([255, 0, 0]), { raw: { width: 1, height: 1, channels: 3 } }).png().toBuffer();
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input.png", bytes);
  const input = retained ? { filesystem, cwd: "/" } : new Map([["/input.png", bytes]]);
  const expressions = ["1/10000000", "1/65535", "1/3", "12345678", "-1/10000000", "1/10000000000", "0", "1/10000", "999999", "1000000", "999999.9", "0.00009999999"];
  const format = expressions.map(expression => `%[fx:${expression}]`).join("|");
  const expected = "1e-07|1.5259e-05|0.333333|1.23457e+07|-1e-07|1e-10|0|0.0001|999999|1e+06|1e+06|0.0001";
  for (const identify of [false, true]) {
    const args = identify ? ["identify", "-format", format, "/input.png"] : ["/input.png", "-format", format, "info:"];
    expect(await runMagickCli(args, input)).toEqual({ exitCode: 0, stderr: "", stdout: expected });
  }
});

it.each([false, true])("preserves small RGB48 standard deviations with retained input=%s", async (retained) => {
  const { encodeImage } = await import("@poe-code/image-ast/portable");
  const data16 = Uint16Array.from([0, 0, 0, 65535, 1, 1, 1, 65535]);
  const bytes = encodeImage({ width: 2, height: 1, format: "png", density: 72, channels: 3, hasAlpha: false, space: "srgb", depth: "ushort",
    data16, data: Uint8Array.from(data16, value => Math.round(value / 257)) }, { format: "png" }).data;
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input.png", bytes);
  const input = retained ? { filesystem, cwd: "/" } : new Map([["/input.png", bytes]]);
  const format = "%[fx:standard_deviation]|%[fx:standard_deviation.r]";
  for (const identify of [false, true]) {
    const args = identify ? ["identify", "-format", format, "/input.png"] : ["/input.png", "-format", format, "info:"];
    expect(await runMagickCli(args, input)).toEqual({ exitCode: 0, stderr: "", stdout: "1.07898e-05|1.07898e-05" });
  }
});
