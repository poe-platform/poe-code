import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runIdentifyCli, runMagickCli } from "./index.js";

for (const retained of [false, true]) {
  it(`reports Q16 identify statistics with retained input=${retained}`, async () => {
    const bytes = await sharp(new Uint8Array([0, 0, 0, 128, 128, 128, 255, 255, 255]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", bytes);
    const input = retained ? { filesystem: fs, cwd: "/" } : new Map([["/input", bytes]]);
    const format = "%[mean] %[standard-deviation] %[min] %[max] %[fx:mean]";
    expect(await runIdentifyCli(["-format", format, "/input"], input))
      .toEqual({ exitCode: 0, stdout: "32810.3 32767.6 0 65535 0.500654", stderr: "" });
    expect(await runMagickCli(["/input", "-format", format, "info:"], input))
      .toEqual({ exitCode: 0, stdout: "32810.3 32767.6 0 65535 0.500654", stderr: "" });
  });

  it(`scales nonzero minima and intermediate maxima with retained input=${retained}`, async () => {
    const bytes = await sharp(new Uint8Array([64, 64, 64, 128, 128, 128, 192, 192, 192]), { raw: { width: 3, height: 1, channels: 3 } }).png().toBuffer();
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", bytes);
    expect(await runIdentifyCli(["-format", "%[mean] %[standard-deviation] %[min] %[max]", "/input"], retained ? { filesystem: fs, cwd: "/" } : new Map([["/input", bytes]])))
      .toEqual({ exitCode: 0, stdout: "32896 16448 16448 49344", stderr: "" });
  });
}
