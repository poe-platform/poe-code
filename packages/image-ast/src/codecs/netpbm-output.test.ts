import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import type {RgbaImage} from "../ast.js";
import {encodePpm, encodePgm} from "./netpbm.js";
import {encodeNetpbmFromStorage} from "./netpbm-storage.js";

it.each(["ppm", "pgm"] as const)("writes exact big-endian %s samples in both output paths", async format => {
  for (const depth of [undefined, 1, 4, 8, 10, 16]) for (const highDepth of [true, false]) for (const width of [2, 1026]) {
    const data16 = Uint16Array.from({length: width * 4}, (_, i) => [0x1234, 0x4567, 0x89ab, 65535, 0xcdef, 0x1379, 0x2468, 65535][i % 8]!);
    const data = Uint8Array.from(data16, value => Math.round(value / 257));
    const image: RgbaImage = {width, height: 1, data, ...(highDepth ? {data16} : {}), format: "png", depth: highDepth ? "ushort" : "uchar", space: "srgb", channels: 3, density: 72, hasAlpha: false};
    const samples = highDepth ? data16 : data;
    const values = Array.from({length: width}, (_, pixel) => format === "ppm" ? Array.from(samples.subarray(pixel * 4, pixel * 4 + 3)) : [.212656 * samples[pixel*4]! + .715158 * samples[pixel*4+1]! + .072186 * samples[pixel*4+2]!]).flat();
    const maximum = 2 ** (depth ?? (highDepth ? 16 : 8)) - 1;
    const wide = maximum > 255;
    const raster = Buffer.alloc(values.length * (wide ? 2 : 1));
    values.forEach((value, i) => {
      const scaled = Math.round(value * maximum / (highDepth ? 65535 : 255));
      if (wide) raster.writeUInt16BE(scaled, i * 2); else raster.writeUInt8(scaled, i);
    });
    const expected = Buffer.concat([Buffer.from(`${format === "ppm" ? "P6" : "P5"}\n${width} 1\n${maximum}\n`), raster]);
    expect(Buffer.from(format === "ppm" ? encodePpm(image, depth) : encodePgm(image, depth))).toEqual(expected);
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      const position = storage.allocate(data.length);
      await storage.write(position, data);
      const storedData16 = {position: storage.allocate(data16.byteLength), length: data16.length};
      await storage.write(storedData16.position, new Uint8Array(data16.buffer));
      const chunks: Uint8Array[] = [];
      for await (const chunk of encodeNetpbmFromStorage({...image, position, ...(highDepth ? {storedData16} : {})}, storage, signal, format, depth)) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(expected);
    } finally {await storage.close();}
  }
});
