import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync, runIdentifyCli } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([undefined, 8])(`preserves native TIFF orientation %s through PNG conversion (${mode})`, async orientation => {
    const pixels = Uint8Array.from([10, 40, 70, 100, 130, 160].flatMap(value => [value, value, value, 255]));
    const { data } = encodeImage({ width: 3, height: 2, data: pixels, format: "tiff", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, orientation: orientation ?? 1 }, { format: "tiff" });
    if (orientation === undefined) {
      // Remove tag 274 from the directory without moving pixel data or other values.
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const ifd = view.getUint32(4, true), count = view.getUint16(ifd, true);
      const tags = Array.from({ length: count }, (_, i) => view.getUint16(ifd + 2 + i * 12, true));
      expect(tags).toContain(274);
      const entry = ifd + 2 + tags.indexOf(274) * 12;
      data.copyWithin(entry, entry + 12, ifd + 2 + count * 12 + 4);
      view.setUint16(ifd, count - 1, true);
      expect(Array.from({ length: count - 1 }, (_, i) => view.getUint16(ifd + 2 + i * 12, true))).not.toContain(274);
    }
    const expected = orientation === undefined ? "TopLeft" : "LeftBottom";
    const native = spawnSync("magick", ["identify", "-format", "%[orientation]", "-"], { input: data, encoding: "utf8" });
    expect(native.status, native.stderr).toBe(0);
    expect(native.stdout).toBe(expected);
    const files = new Map([["/input.tif", data]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.tif", data);
    const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
    expect(await runIdentifyCli(["-format", "%[orientation]", "/input.tif"], input)).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    const args = ["/input.tif", "/output.png"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
    expect(decodeImage(output)).toMatchObject({ width: 3, height: 2, data: pixels, orientation: orientation ?? 1 });
    const converted = spawnSync("magick", ["identify", "-format", "%[orientation]", "-"], { input: output, encoding: "utf8" });
    expect(converted.status, converted.stderr).toBe(0);
    expect(converted.stdout).toBe(expected);
  });
}
