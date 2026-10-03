import {deflateSync} from "node:zlib";
import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {decodePngToStorage} from "./png-storage.js";

function chunk(name: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12);
  new DataView(result.buffer).setUint32(0, data.length);
  result.set(new TextEncoder().encode(name), 4); result.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  new DataView(result.buffer).setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}
function png(width: number, height: number, raw: Uint8Array, depth = 8, color = 6, extras: Uint8Array[] = [], interlace = false): Uint8Array {
  const header = new Uint8Array(13); const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height); header[8] = depth; header[9] = color; header[12] = interlace ? 1 : 0;
  const compressed = deflateSync(raw);
  const chunks = [Uint8Array.of(137,80,78,71,13,10,26,10), chunk("IHDR", header), ...extras];
  for (let start = 0; start < compressed.length; start += 113) chunks.push(chunk("IDAT", compressed.subarray(start, start + 113)));
  chunks.push(chunk("IEND", new Uint8Array()));
  return Buffer.concat(chunks);
}
function source(bytes: Uint8Array) {
  const borrowed = new Uint8Array(4096);
  return {size: bytes.length, read: vi.fn(async (offset: number, length: number) => {
    expect(length).toBeLessThanOrEqual(4096);
    borrowed.fill(0); borrowed.set(bytes.subarray(offset, offset + length));
    return borrowed.subarray(0, length);
  })};
}
function backing() {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file read"));
  vi.spyOn(fs, "writeFile").mockRejectedValue(new Error("whole-file write"));
  return {fs, storage};
}

it("decodes a zlib PNG wider than the working window through bounded borrowed ranges and caller backing", async () => {
  const width = 2053, height = 23, row = 1 + width * 4;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    raw.set([x & 255, y, (x + y) & 255, 255], y * row + 1 + x * 4);
  }
  const input = source(png(width, height, raw)); const {fs, storage} = backing();
  const write = vi.spyOn(storage, "write");
  try {
    const image = await decodePngToStorage(input, storage, new AbortController().signal);
    expect(image).toMatchObject({width, height, format: "png", channels: 4});
    for (const [x, y] of [[0,0], [2052,22], [1023,11]]) {
      expect([...await storage.read(image.position + (y! * width + x!) * 4, 4)]).toEqual([x! & 255, y, (x! + y!) & 255, 255]);
    }
    expect(write.mock.calls.every(([,bytes]) => bytes.length <= 4096)).toBe(true);
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("preserves packed palette transparency without expanding whole scanlines", async () => {
  const input = source(png(4, 1, Uint8Array.of(0, 0b00011011), 2, 3, [
    chunk("PLTE", Uint8Array.of(10,20,30,40,50,60,70,80,90,100,110,120)), chunk("tRNS", Uint8Array.of(0,80,160))
  ]));
  const {storage} = backing();
  try {
    const image = await decodePngToStorage(input, storage, new AbortController().signal);
    expect([...await storage.read(image.position, 16)]).toEqual([10,20,30,0,40,50,60,80,70,80,90,160,100,110,120,255]);
  } finally {await storage.close();}
});

it("preserves cancellation identity and does not acquire backing after pre-abort", async () => {
  const signal = AbortSignal.abort({reason: "caller stopped"});
  const input = source(png(1, 1, Uint8Array.of(0,1,2,3,4))); const {storage} = backing();
  try {await expect(decodePngToStorage(input, storage, signal)).rejects.toBe(signal.reason);}
  finally {await storage.close();}
  expect(input.read).not.toHaveBeenCalled();
});

it.each([false, true])("reconstructs all PNG filters and Adam7 scattering (interlace=%s)", async interlace => {
  const width = 19, height = 17;
  const pixel = (x: number, y: number) => [x * 11 & 255, y * 13 & 255, x * y & 255, (x + y) * 7 & 255];
  const parts: number[] = [];
  const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
  for (const [x0,y0,dx,dy] of passes as [number,number,number,number][]) {
    let previous: number[] = [];
    for (let y = y0; y < height; y += dy) {
      const row: number[] = [];
      for (let x = x0; x < width; x += dx) row.push(...pixel(x,y));
      if (!row.length) continue;
      const filter = y % 5; parts.push(filter);
      for (let index = 0; index < row.length; index++) {
        const a = row[index - 4] ?? 0, b = previous[index] ?? 0, c = previous[index - 4] ?? 0;
        const p = a + b - c, distances = [Math.abs(p-a), Math.abs(p-b), Math.abs(p-c)];
        const paeth = [a,b,c][distances.indexOf(Math.min(...distances))]!;
        const predictor = [0,a,b,Math.floor((a+b)/2),paeth][filter]!;
        parts.push((row[index]! - predictor) & 255);
      }
      previous = row;
    }
  }
  const {storage} = backing();
  try {
    const image = await decodePngToStorage(source(png(width,height,Uint8Array.from(parts),8,6,[],interlace)),storage,new AbortController().signal);
    const expected: number[] = [];
    for (let y=0;y<height;y++) for(let x=0;x<width;x++) expected.push(...pixel(x,y));
    expect([...await storage.read(image.position, expected.length)]).toEqual(expected);
  } finally {await storage.close();}
});

it.each([
  {depth: 1, color: 0, raw: [0, 0b01000000], expected: [0,0,0,255,255,255,255,255]},
  {depth: 4, color: 0, raw: [0, 0x3c], expected: [51,51,51,255,204,204,204,255]},
  {depth: 8, color: 4, raw: [0, 51, 80, 204, 160], expected: [51,51,51,80,204,204,204,160]},
  {depth: 16, color: 0, raw: [0, 51, 1, 204, 2], expected: [51,51,51,255,204,204,204,255]},
  {depth: 16, color: 2, raw: [0, 1,2,3,4,5,6,7,8,9,10,11,12], expected: [1,3,5,255,7,9,11,255]},
  {depth: 16, color: 6, raw: [0, 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16], expected: [1,3,5,7,9,11,13,15]}
])("preserves depth=$depth color=$color samples", async ({depth,color,raw,expected}) => {
  const {storage} = backing();
  try {
    const image = await decodePngToStorage(source(png(2,1,Uint8Array.from(raw),depth,color)),storage,new AbortController().signal);
    expect([...await storage.read(image.position,8)]).toEqual(expected);
  } finally {await storage.close();}
});

it("rejects complete zlib data with a truncated PNG scanline", async () => {
  const {storage} = backing();
  try {await expect(decodePngToStorage(source(png(2,1,Uint8Array.of(0,1,2,3,4))),storage,new AbortController().signal)).rejects.toThrow("Truncated PNG image data");}
  finally {await storage.close();}
});

it("awaits backing writes before pulling more input and preserves cancellation during backpressure", async () => {
  const {storage} = backing();
  const input = source(png(3000,1,new Uint8Array(12001)));
  const controller = new AbortController();
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => {entered=resolve;});
  const gate = new Promise<void>(resolve => {release=resolve;});
  vi.spyOn(storage,"write").mockImplementationOnce(async () => {entered(); await gate;});
  const pending = decodePngToStorage(input,storage,controller.signal);
  await ready;
  const reads = input.read.mock.calls.length;
  await Promise.resolve(); await Promise.resolve();
  expect(input.read).toHaveBeenCalledTimes(reads);
  const reason = {cancel:"backing stalled"}; controller.abort(reason); release();
  try {await expect(pending).rejects.toBe(reason);}
  finally {await storage.close();}
});

it("rejects malformed sample layouts before allocating pixel backing", async () => {
  const {storage} = backing(); const allocate = vi.spyOn(storage,"allocate");
  try {await expect(decodePngToStorage(source(png(1,1,Uint8Array.of(0),255,6)),storage,new AbortController().signal)).rejects.toThrow("Unsupported PNG encoding");}
  finally {await storage.close();}
  expect(allocate).not.toHaveBeenCalled();
});
