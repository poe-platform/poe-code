import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { decodeImage, encodeImage } from "./index.js";

for (const samplingFactor of ["1x1", "2x2", "2x1", "4x1", "1x2", "2x2,2x1,1x1"]) {
  it(`preserves baseline pixels in progressive scans with sampling ${samplingFactor}`, () => {
    const width = 35, height = 19, data = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) data.set([p * 17 % 256, p * 23 % 256, p * 9 % 256, p % 256], p * 4);
    const image = { width, height, data };
    const baseline = encodeImage(image, { format: "jpeg", samplingFactor }).data;
    const progressive = encodeImage(image, { format: "jpeg", samplingFactor, jpegProgressive: true }).data;
    expect(progressive.some((byte, i) => byte === 255 && progressive[i + 1] === 0xc2)).toBe(true);
    expect(decodeImage(progressive).data).toEqual(decodeImage(baseline).data);
  });
}
it("exposes progressive JPEG through the file-backed sharp API", async () => {
  const filesystem = new MemoryFileSystem();
  const png = encodeImage({ width: 1, height: 1, data: new Uint8Array([23, 45, 67, 255]) }, { format: "png" }).data;
  await filesystem.writeFile("/in.png", png);
  await sharp("/in.png", { filesystem }).jpeg({ progressive: true }).toFile("/out.jpg");
  const bytes = await filesystem.readFile("/out.jpg");
  expect(bytes.some((byte, i) => byte === 255 && bytes[i + 1] === 0xc2)).toBe(true);
  expect(decodeImage(bytes).width).toBe(1);
});
