import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli } from "./index.js";
import fixtures from "./tiff-planar-fixtures.json" with { type: "json" };

// Native ImageMagick planar TIFFs, independently decoded back to these exact RGBA pixels.
const pixels = Uint8Array.from({ length: 48 * 40 * 4 }, (_, i) => {
  const x = Math.floor(i / 4) % 48, y = Math.floor(i / (48 * 4));
  return [(7 * x + 11 * y) % 256, 60, 200, x % 2 ? 128 : 255][i % 4]!;
});
for (const [name, fixture] of Object.entries(fixtures)) {
  it.each([false, true])(`preserves every RGBA pixel in planar TIFF ${name}, retained=%s`, async retained => {
    const input = new Uint8Array(Buffer.from(fixture, "base64"));
    const files = new Map([["/in.tif", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.tif", input);
    expect(await runConvertCli(["/in.tif", "/out.png"], retained ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([48, 40]);
    expect(output.data).toEqual(pixels);
    expect(decodeImage(input).data).toEqual(pixels);
  });
}
