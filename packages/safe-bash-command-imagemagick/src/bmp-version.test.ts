import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [255,0,0,255, 0,255,0,128, 0,0,255,0];
const input = encodeImage({ width: 3, height: 1, data: new Uint8Array(pixels), format: "png", space: "srgb", channels: 4, depth: "uchar", density: 150, hasAlpha: true }, { format: "png" }).data;
for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const [args, size] of [
    [["BMP2:/out.bmp"], 12], [["BMP3:/out.bmp"], 40],
    [["-define", "bmp:format=bmp2", "/out.bmp"], 12],
    [["-define", "bmp:format=bmp3", "/out.bmp"], 40],
    [["-define", "bmp:format=bmp4", "/out.bmp"], 124],
    [["BMP:/out.bmp"], 124], [["/out.bmp"], 124],
    [["-define", "bmp:format=bmp2", "+define", "bmp:format", "/out.bmp"], 124],
    [["-define", "bmp:format=bmp4", "BMP2:/out.bmp"], 12],
    [["-write", "BMP2:/copy.bmp", "BMP3:/out.bmp"], 40]
  ] as const) {
    it(`writes BMP header ${size} and resolves the filename (${mode}, ${args.join(" ")})`, async () => {
      const files = new Map([["/in.png", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.png", input);
      const argv = ["/in.png", ...args];
      const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const output = mode === "retained" ? await filesystem.readFile("/out.bmp") : files.get("/out.bmp")!;
      expect(output).toBeDefined();
      const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
      expect(view.getUint32(14, true)).toBe(size);
      expect(view.getUint32(2, true)).toBe(output.length);
      expect(view.getUint32(10, true)).toBe(14 + size);
      expect(Array.from(decodeImage(output).data)).toEqual(pixels.map((value, i) => i % 4 === 3 && size !== 124 ? 255 : value));
      if (args.some(arg => arg === "-write")) {
        const copy = mode === "retained" ? await filesystem.readFile("/copy.bmp") : files.get("/copy.bmp")!;
        expect(new DataView(copy.buffer, copy.byteOffset, copy.byteLength).getUint32(14, true)).toBe(12);
      }
    });
  }
}

for (const [name, data, colorType] of [
  ["rgb", [255,0,0,255, 0,255,0,255, 0,0,255,255], 2],
  ["gray", [32,32,32,255, 123,123,123,255, 240,240,240,255], 0],
  ["mono", [0,0,0,255, 255,255,255,255, 255,255,255,255], 0],
  ["palette", [255,0,0,255, 0,255,0,255, 0,0,255,255], 3]
] as const) {
  it(`preserves ${name} colors in every BMP version`, async () => {
    const filesystem = new MemoryFileSystem();
    const source = encodeImage({ width: 3, height: 1, data: new Uint8Array(data), format: "png", space: "srgb", channels: 3, depth: "uchar", density: 150, hasAlpha: false }, { format: "png", pngColorType: colorType }).data;
    await filesystem.writeFile("/in.png", source);
    for (const [version, size] of [["bmp2",12], ["bmp3",40], ["bmp4",124]] as const) {
      const result = await runConvertCli(["/in.png", "-define", `bmp:format=${version}`, "/out.bmp"], { filesystem, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      const output = await filesystem.readFile("/out.bmp");
      expect(new DataView(output.buffer, output.byteOffset, output.byteLength).getUint32(14, true)).toBe(size);
      expect(Array.from(decodeImage(output).data)).toEqual(data);
    }
    expect((await filesystem.readdir("/")).map(entry => entry.name).sort()).toEqual(["in.png", "out.bmp"]);
  });
}
