import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([[72, 2834], [80, 3149], [96, 3779], [100, 3937], [254, 10000]])(
    `matches native TIFF inch resolution in PNG pHYs (${mode}, %i dpi)`, async (density, expected) => {
      const pixels = Uint8Array.of(16, 32, 48, 255, 64, 80, 96, 255, 112, 128, 144, 255, 160, 176, 192, 255);
      const { data } = encodeImage({ width: 2, height: 2, data: pixels, format: "tiff", space: "srgb",
        channels: 3, depth: "uchar", density, hasAlpha: false,
        resolution: { x: density, y: density, unit: "inch" } }, { format: "tiff" });
      const files = new Map([["/input.tif", data]]), fs = new MemoryFileSystem();
      await fs.writeFile("/input.tif", data);
      const args = ["/input.tif", "/output.png"];
      const result = mode === "command" ? await createMagickCommand().execute({ command: "magick",
        args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} } })
        : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0 });
      const output = mode === "retained" || mode === "command" ? await fs.readFile("/output.png") : files.get("/output.png")!;
      const png = new DataView(output.buffer, output.byteOffset, output.byteLength);
      let physical: number[] | undefined;
      for (let offset = 8; offset < output.length; offset += 12 + png.getUint32(offset)) {
        if (new TextDecoder().decode(output.subarray(offset + 4, offset + 8)) === "pHYs") {
          physical = [png.getUint32(offset + 8), png.getUint32(offset + 12), png.getUint8(offset + 16)];
        }
      }
      expect(physical).toEqual([expected, expected, 1]);
      expect(decodeImage(output)).toMatchObject({ width: 2, height: 2, data: pixels });
    });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([false, true])(`preserves TIFF resolution presence through PNG conversion (${mode}, tags=%s)`, async tagged => {
    const pixels = Uint8Array.from([0, 255, 0, 255].flatMap(value => [value, value, value, 255]));
    const { data } = encodeImage({ width: 2, height: 2, data: pixels, format: "tiff", space: "srgb", channels: 3, depth: "ushort", density: 144, hasAlpha: false }, { format: "tiff", tiffIntegerDepth: 16 });
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const ifd = view.getUint32(4, true);
    let count = view.getUint16(ifd, true);
    if (!tagged) {
      for (let i = count - 1; i >= 0; i--) {
        const entry = ifd + 2 + i * 12;
        if ([282, 283, 296].includes(view.getUint16(entry, true))) {
          data.copyWithin(entry, entry + 12, ifd + 2 + count * 12 + 4);
          view.setUint16(ifd, --count, true);
        }
      }
      expect(Array.from({ length: count }, (_, i) => view.getUint16(ifd + 2 + i * 12, true))).not.toEqual(expect.arrayContaining([282, 283, 296]));
    }
    const files = new Map([["/input.tif", data]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.tif", data);
    const args = ["/input.tif", "/output.png"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
    const chunks: string[] = [], png = new DataView(output.buffer, output.byteOffset, output.byteLength);
    for (let offset = 8; offset < output.length; offset += 12 + png.getUint32(offset)) {
      chunks.push(new TextDecoder().decode(output.subarray(offset + 4, offset + 8)));
    }
    expect(chunks.includes("pHYs")).toBe(tagged);
    const decoded = decodeImage(output);
    expect(decoded).toMatchObject({ width: 2, height: 2, data: pixels, density: tagged ? 144 : 72 });
    expect(decoded.resolution?.unit).toBe(tagged ? "meter" : undefined);
  });
}
