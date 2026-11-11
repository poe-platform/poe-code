import { expect, it, vi } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp, { encodeImage, encodeStoredImage, type RgbaImage, type ImageByteStorage } from "../index.js";

it.each([
  [1, 129, "0000018101"], [7, 2, "00000702"], [8, 2, "00000802"],
  [127, 1, "00007f01"], [128, 1, "0000810001"], [1101, 2, "0000884d02"],
] as const)("encodes WBMP %ix%i with padded rows and bounded storage reads", async (width, height, header) => {
  const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.floor(i / 4) % 3 ? 255 : 0);
  const image: RgbaImage = { width, height, data, format: "raw", space: "srgb", channels: 4, hasAlpha: true, depth: "uchar", density: 72 };
  const encoded = encodeImage(image, { format: "wbmp" });
  expect(encoded).toMatchObject({ format: "wbmp", channels: 1 });
  const bytes = encoded.data, start = header.length / 2, stride = Math.ceil(width / 8);
  expect(Buffer.from(bytes.subarray(0, start)).toString("hex")).toBe(header);
  expect(bytes.length).toBe(start + stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < stride * 8; x++) {
    const white = (bytes[start + y * stride + Math.floor(x / 8)]! >> (7 - x % 8)) & 1;
    expect(white).toBe(x < width && (y * width + x) % 3 ? 1 : 0);
  }
  const storage: ImageByteStorage = {
    allocate() { throw new Error("unexpected allocation"); },
    async write() { throw new Error("unexpected write"); },
    async read(position, length) {
      expect(length).toBeLessThanOrEqual(4096);
      return data.subarray(position - 31, position - 31 + length);
    },
  };
  const stream = encodeStoredImage({ ...image, position: 31 }, storage, new AbortController().signal, { format: "wbmp" });
  const chunks: Uint8Array[] = [];
  let step = await stream.next();
  while (!step.done) { chunks.push(step.value); step = await stream.next(); }
  expect(step.value).toMatchObject({ format: "wbmp", channels: 1, width, height, size: bytes.length });
  expect(Buffer.concat(chunks)).toEqual(Buffer.from(bytes));
  expect(await sharp(data, { raw: { width, height, channels: 4 } }).toFormat("wbmp").toBuffer()).toEqual(bytes);
});

it("rejects truncated storage and honors cancellation before reading", async () => {
  const image = { position: 0, width: 1, height: 1, format: "raw" as const, space: "srgb" as const, channels: 4 as const, hasAlpha: true, depth: "uchar" as const, density: 72 };
  const read = vi.fn(async () => new Uint8Array(3));
  const storage: ImageByteStorage = { read, allocate: () => 0, async write() {} };
  const controller = new AbortController(), stream = encodeStoredImage(image, storage, controller.signal, { format: "wbmp" });
  await stream.next();
  await expect(stream.next()).rejects.toThrow("Truncated WBMP pixel storage");
  read.mockClear();
  const reason = new Error("cancelled"); controller.abort(reason);
  await expect(encodeStoredImage(image, storage, controller.signal, { format: "wbmp" }).next()).rejects.toBe(reason);
  expect(read).not.toHaveBeenCalled();
});

it("infers WBMP from the SDK output filename", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/in.pbm", Buffer.from("P1\n3 1\n0 1 0\n"));
  const info = await sharp("/in.pbm", { filesystem }).toFile("/out.wbmp");
  expect(info).toMatchObject({ format: "wbmp", width: 3, height: 1, channels: 1, size: 5 });
  expect(Buffer.from(await filesystem.readFile("/out.wbmp"))).toEqual(Buffer.from("00000301a0", "hex"));
});
