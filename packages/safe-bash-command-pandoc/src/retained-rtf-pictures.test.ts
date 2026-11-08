import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {inspectRtfPicture} from "./rtf-pictures.js";
import {inspectRetainedRtfPicture} from "./retained-rtf-pictures.js";
// Authored PNG: a stored DEFLATE block containing one gray scanline, not a fixture.
function png(width = 1, height = 1): Uint8Array {
  const u32 = (n: number) => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  function chunk(name: string, data: number[]): number[] {
    const body = [...name].map(c => c.charCodeAt(0)).concat(data);
    let crc = 0xffffffff;
    for(const byte of body) {crc ^= byte; for(let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);}
    return [...u32(data.length), ...body, ...u32((crc ^ 0xffffffff) >>> 0)];
  }
  return new Uint8Array([137,80,78,71,13,10,26,10,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8,0,0,0,0]),
    ...chunk("IDAT", [0x78,0x01,0x01,2,0,253,255,0,128,0,130,0,129]), ...chunk("IEND", [])]);
}
// A one-component baseline JPEG: DC zero and EOB, with explicit one-bit tables.
function jpeg(progressive = false): Uint8Array {
  const segment = (marker: number, data: number[]) => [255, marker, (data.length + 2) >>> 8, (data.length + 2) & 255, ...data];
  return new Uint8Array([255,216, ...segment(219, [0, ...Array<number>(64).fill(1)]),
    ...segment(progressive ? 194 : 192, [8,0,1,0,1,1,1,0x11,0]),
    ...segment(196, [0,1,...Array<number>(15).fill(0),0, 16,1,...Array<number>(15).fill(0),0]),
    ...(progressive ? [...segment(218,[1,1,0,0,0,0]),0x7f,...segment(218,[1,1,0,1,63,0]),0x7f] : [...segment(218, [1,1,0,0,63,0]), 0x3f]),255,217]);
}

it("preserves PNG, baseline/progressive JPEG validation with caller-backed decoder state", async () => {
  const broken = jpeg(true); broken[broken.length - 3] = 255;
  const badCrc = png(); badCrc[badCrc.length - 1]! ^= 1;
  const values = [png(), jpeg(), jpeg(true), png(2, 1), png(32768, 1), png().slice(0, 40), jpeg().slice(0, -1), broken, badCrc, new Uint8Array([1, 2])];
  for (const bytes of values) {
    const expectedContext = new ExecutionContext("convert", {}), expected = await inspectRtfPicture(bytes, expectedContext).catch(error => error);
    await expectedContext.close();
    const fs = new MemoryFileSystem(), controller = new AbortController(), context = new ExecutionContext("convert", {signal: controller.signal});
    const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: controller.signal}, 1);
    const readFile = vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-resource reads forbidden"));
    let largest = 0;
    const source = {size: bytes.length, async read(offset: number, length: number) {largest = Math.max(largest, length); return bytes.slice(offset, offset + length);}};
    try {
      const actual = await inspectRetainedRtfPicture(source, storage, context).catch(error => error);
      if (expected instanceof Error) expect(actual).toMatchObject({code: (expected as {code?: string}).code, message: expected.message});
      else expect(actual).toEqual(expected);
      expect(largest).toBeLessThanOrEqual(16384); expect(readFile).not.toHaveBeenCalled();
    } finally {await storage.close(); await context.close();}
    expect(await fs.readdir("/")).toEqual([]);
  }
});
it.each(["source", "backing", "cancel"])("preserves %s failures during retained picture validation", async mode => {
  const fs = new MemoryFileSystem(), controller = new AbortController(), bytes = jpeg();
  const context = new ExecutionContext("convert", {signal: controller.signal});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: controller.signal}, 1);
  if (mode === "backing") vi.spyOn(storage, "write").mockRejectedValue(new Error("Backing write failed"));
  let reads = 0;
  const source = {size: bytes.length, async read(offset: number, length: number) {
    if (++reads === 3) {if (mode === "source") throw new Error("Source read failed"); if (mode === "cancel") controller.abort();}
    return bytes.slice(offset, offset + length);
  }};
  try {
    await expect(inspectRetainedRtfPicture(source, storage, context)).rejects.toMatchObject({code: mode === "cancel" ? "E_CANCELLED" : "E_IO"});
  } finally {await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
