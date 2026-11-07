import { expect, it } from "vitest";
import { encodeImage, decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const write of [false, true]) {
    it.each([[16, 2], [8, 2]] as const)(`honors png:bit-depth=%s, retained=${retained}, write=${write}`, async (depth, color) => {
      const pixels = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);
      const source = encodeImage({ width: 2, height: 1, density: 72, data: pixels, format: "png", channels: 3, hasAlpha: false, space: "srgb", depth: "uchar" }, { format: "png" }).data;
      const files = new Map([["/input.png", source]]);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.png", source);
      const output = "/output.png";
      const result = await runConvertCli(["/input.png", "-define", `png:bit-depth=${depth}`, ...(write ? ["-write", output, "null:"] : [output])], retained ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const bytes = retained ? await fs.readFile("/output.png") : files.get("/output.png");
      expect(bytes).toBeDefined();
      expect(Array.from(bytes!.slice(24, 26))).toEqual([depth, color]);
      const decoded = decodeImage(bytes!);
      expect(Array.from(decoded.data)).toEqual(Array.from(pixels));
      if (depth === 16) expect(Array.from(decoded.data16!)).toEqual(Array.from(pixels, value => value * 257));
    });
  }
}


for (const retained of [false, true]) {
  it(`reduces 16-bit PNG storage to explicit 8-bit, retained=${retained}`, async () => {
    const pixels = Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255);
    const source = encodeImage({ width: 2, height: 1, density: 72, data: pixels, data16: Uint16Array.from(pixels, value => value * 257), format: "png", channels: 3, hasAlpha: false, space: "srgb", depth: "ushort" }, { format: "png" }).data;
    const files = new Map([["/input.png", source]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", source);
    const result = await runConvertCli(["/input.png", "-define", "png:bit-depth=8", "/output.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const bytes = retained ? await fs.readFile("/output.png") : files.get("/output.png")!;
    expect(Array.from(bytes.slice(24, 26))).toEqual([8, 2]);
    expect(Array.from(decodeImage(bytes).data)).toEqual(Array.from(pixels));
  });
}
