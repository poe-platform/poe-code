import { expect, it } from "vitest";
import sharp, { encodeImage, type RgbaImage } from "../index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeStoredImage } from "../image-encode.js";

for (const gray of [false, true]) for (const depth of [8, 16]) {
  it(`writes bottom-up FITS planes and bounded storage (${gray ? "gray" : "RGB"}, ${depth} bit)`, async () => {
    const width = 513, height = 3;
    const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => (gray ? Math.floor(i / 4) : i) % 256);
    const data16 = depth === 16 ? Uint16Array.from(data, (v, i) => v * 256 + (gray ? Math.floor(i / 4) : i) % 256) : undefined;
    const image: RgbaImage = { width, height, data, ...(data16 ? { data16 } : {}), format: "raw", depth: data16 ? "ushort" : "uchar", space: "srgb", channels: 4, hasAlpha: true, density: 72 };
    const encoded = encodeImage(image, { format: "fits" });
    const channels = gray ? 1 : 3;
    expect(encoded).toMatchObject({ format: "fits", channels });
    const backing = new Uint8Array((data16 ?? data).buffer), chunks: Uint8Array[] = [];
    const steps = encodeStoredImage({ ...image, position: 5, ...(data16 ? { storedData16: { position: 5, length: data16.byteLength } } : {}) }, {
      allocate() { throw new Error("Must not allocate storage"); },
      async write() { throw new Error("Must not mutate storage"); },
      async read(position, length) {
        expect(length).toBeLessThanOrEqual(4096);
        const bytes = new Uint8Array(length + 1);
        bytes.set(backing.subarray(position - 5, position - 5 + length), 1);
        return bytes.subarray(1);
      }
    }, new AbortController().signal, { format: "fits" });
    let step = await steps.next();
    while (!step.done) { chunks.push(step.value); step = await steps.next(); }
    expect(step.value).toMatchObject({ format: "fits", channels, size: encoded.data.length });
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(encoded.data));
    const cards = new Map<string, string>();
    for (let offset = 0; offset < 2880; offset += 80) {
      const card = new TextDecoder().decode(encoded.data.subarray(offset, offset + 80));
      if (card.trim() === "END") break;
      cards.set(card.slice(0, 8).trim(), card.slice(10).trim());
    }
    expect(Number(cards.get("BITPIX"))).toBe(depth);
    expect(Number(cards.get("NAXIS"))).toBe(gray ? 2 : 3);
    expect(Number(cards.get("BZERO"))).toBe(depth === 16 ? 32768 : 0);
    if (!gray) expect(Number(cards.get("NAXIS3"))).toBe(3);
    const view = new DataView(encoded.data.buffer);
    let offset = 2880;
    for (let channel = 0; channel < channels; channel++) for (let y = height - 1; y >= 0; y--) for (let x = 0; x < width; x++) {
      const value = depth === 16 ? view.getInt16(offset) + 32768 : view.getUint8(offset);
      expect(value).toBe((data16 ?? data)[(y * width + x) * 4 + channel]);
      offset += depth / 8;
    }
    expect(encoded.data.length).toBe(Math.ceil(offset / 2880) * 2880);
    expect(encoded.data.subarray(offset).every(byte => byte === 0)).toBe(true);
  });
}

it("selects FITS through sharp file and explicit format output", async () => {
  const filesystem = new MemoryFileSystem();
  const input = Buffer.concat([Buffer.from("P5\n3 2\n255\n"), Buffer.from("8020100040ff", "hex")]);
  await filesystem.writeFile("/in.pgm", input);
  const result = await sharp("/in.pgm", { filesystem }).toFile("/out.fits");
  const sync = sharp(input).toFormat("fits").toBufferSync();
  expect(result).toMatchObject({ format: "fits", channels: 1, size: 5760 });
  expect(await filesystem.readFile("/out.fits")).toEqual(sync);
});

it("does not add an empty FITS data block at an exact block boundary", () => {
  const image: RgbaImage = { width: 2880, height: 1, data: new Uint8Array(2880 * 4), format: "raw", depth: "uchar", space: "b-w", channels: 1, hasAlpha: false, density: 72 };
  expect(encodeImage(image, { format: "fits" }).data).toHaveLength(5760);
});
