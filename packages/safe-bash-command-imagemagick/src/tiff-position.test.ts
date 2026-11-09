import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { runConvertCli, runConvertCliSync, runIdentifyCli } from "./index.js";

for (const mode of ["sync", "buffered", "retained"] as const) {
  it.each([
    { x: true, y: true, autoOrient: false, unit: "inch", expected: [40, 30] },
    { x: true, y: true, autoOrient: true, unit: "inch", expected: [-30, 40] },
    { x: false, y: false, autoOrient: false, unit: "inch", expected: [0, 0] },
    { x: true, y: false, autoOrient: false, unit: "cm", expected: [40, 0] },
    { x: false, y: true, autoOrient: false, unit: "unknown", expected: [0, 30] }
  ] as const)(`preserves TIFF position through PNG (${mode}, %j)`, async scenario => {
    const pixels = Uint8Array.from([16, 32, 48, 255, 64, 80, 96, 255, 112, 128, 144, 255, 160, 176, 192, 255]);
    const encoded = encodeImage({ width: 2, height: 2, data: pixels, format: "tiff", space: "srgb", channels: 3, depth: "uchar", density: 80, resolution: { x: 80, y: 40, unit: scenario.unit }, hasAlpha: false, orientation: 6 }, { format: "tiff" }).data;
    // Append a replacement directory so existing sample and rational offsets stay valid.
    const original = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
    const oldIfd = original.getUint32(4, true), count = original.getUint16(oldIfd, true);
    const tags = [scenario.x ? 286 : 0, scenario.y ? 287 : 0].filter(Boolean);
    const ifd = encoded.length, rational = ifd + 2 + (count + tags.length) * 12 + 4;
    const data = new Uint8Array(rational + tags.length * 8);
    data.set(encoded);
    const view = new DataView(data.buffer);
    view.setUint32(4, ifd, true);
    view.setUint16(ifd, count + tags.length, true);
    const entries = Array.from({ length: count }, (_, i) => encoded.slice(oldIfd + 2 + i * 12, oldIfd + 14 + i * 12));
    for (const [i, tag] of tags.entries()) {
      const entry = new Uint8Array(12), value = new DataView(entry.buffer);
      value.setUint16(0, tag, true);
      value.setUint16(2, 5, true);
      value.setUint32(4, 1, true);
      value.setUint32(8, rational + i * 8, true);
      view.setUint32(rational + i * 8, tag === 286 ? 1 : 3, true);
      view.setUint32(rational + i * 8 + 4, tag === 286 ? 2 : 4, true);
      entries.push(entry);
    }
    entries.sort((a, b) => new DataView(a.buffer).getUint16(0, true) - new DataView(b.buffer).getUint16(0, true));
    entries.forEach((entry, i) => data.set(entry, ifd + 2 + i * 12));
    const files = new Map([["/input.tif", data]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.tif", data);
    const input = mode === "retained" ? { filesystem, cwd: "/" } : files;
    const args = ["/input.tif", ...(scenario.autoOrient ? ["-auto-orient"] : []), "/output.png"];
    expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, input)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const [x, y] = scenario.expected;
    expect(await runIdentifyCli(["-format", "%g", "/output.png"], input)).toEqual({ exitCode: 0, stdout: `2x2${x < 0 ? "" : "+"}${x}${y < 0 ? "" : "+"}${y}`, stderr: "" });
    const output = mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!;
    expect(decodeImage(output).data).toEqual(scenario.autoOrient ? Uint8Array.from([2, 0, 3, 1].flatMap(i => Array.from(pixels.subarray(i * 4, i * 4 + 4)))) : pixels);
  });
}
