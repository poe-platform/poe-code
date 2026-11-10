import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const data = new Uint8Array(35 * 19 * 4);
for (let y = 0; y < 19; y++) for (let x = 0; x < 35; x++) {
  data.set([(x * 17 + y * 7) % 256, (x * 13 + y * 23) % 256, (x * 9 + y * 11) % 256, 255], (y * 35 + x) * 4);
}
const png = encodeImage({ width: 35, height: 19, data, format: "raw", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
function markers(bytes: Uint8Array, marker: number) {
  return bytes.reduce((count, byte, i) => count + Number(byte === 255 && bytes[i + 1] === marker), 0);
}
for (const retained of [false, true]) for (const quality of [80, 92]) {
  it(`writes progressive JPEG with identical pixels and resets interlace, retained=${retained}, quality=${quality}`, async () => {
    const fs = new MemoryFileSystem(), files = new Map([["grid.png", png]]);
    await fs.writeFile("/grid.png", png);
    const result = await runConvertCli(["grid.png", "-quality", String(quality), "-interlace", "Plane", "-write", "plane.jpg", "-interlace", "Line", "-write", "line.jpg", "-interlace", "None", "-write", "none.jpg", "-interlace", "Plane", "+interlace", "out.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const outputs = await Promise.all(["plane.jpg", "line.jpg", "none.jpg", "out.jpg"].map(path => retained ? fs.readFile(`/${path}`) : files.get(path)!));
    for (const bytes of [outputs[0]!, outputs[1]!, outputs[3]!]) {
      expect(markers(bytes, 0xc2)).toBe(1);
      expect(markers(bytes, 0xda)).toBeGreaterThan(1);
      expect(decodeImage(bytes).data).toEqual(decodeImage(outputs[2]!).data);
    }
    expect(markers(outputs[2]!, 0xc0)).toBe(1);
    expect(markers(outputs[2]!, 0xda)).toBe(1);
    const numbered = await runConvertCli(["grid.png", "-interlace", "Plane", "numbered-%d.jpg"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(numbered.exitCode, numbered.stderr).toBe(0);
    const bytes = retained ? await fs.readFile("/numbered-0.jpg") : files.get("numbered-0.jpg")!;
    expect(markers(bytes, 0xc2)).toBe(1);
    expect(decodeImage(bytes).width).toBe(35);
  });
}
