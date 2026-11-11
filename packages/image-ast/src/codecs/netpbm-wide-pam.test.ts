import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import type {RgbaImage} from "../ast.js";
import {encodePpm} from "./netpbm.js";
import {encodeNetpbmFromStorage} from "./netpbm-storage.js";

for (const space of ["srgb", "b-w", "cmyk"] as const) for (const highDepth of [false, true]) {
  it.each([17, 24, 32])(`writes ${space} PAM alpha at depth %i from ${highDepth ? 16 : 8}-bit buffers and storage`, async depth => {
    const width = 1026;
    const data = Uint8Array.from({length: width * 4}, (_, i) => [0, 127, 255, 85][i % 4]!);
    const data16 = Uint16Array.from(data, value => value * 257);
    const hueSamples = Float64Array.from({length: width * 4}, (_, i) => [0, 1 / 3, 2 / 3, 1][i % 4]!);
    const image: RgbaImage = {width, height: 1, data, ...(highDepth ? {data16} : {}), ...(space === "cmyk" ? {hueSamples} : {}), format: "pam", depth: highDepth ? "ushort" : "uchar", space, channels: space === "cmyk" ? 5 : space === "b-w" ? 2 : 4, density: 72, hasAlpha: true};
    const maximum = 2 ** depth - 1;
    const values = space === "cmyk" ? [0, 1 / 3, 2 / 3, 1, 1 / 3] : space === "b-w" ? [0, 1 / 3] : [0, 127 / 255, 1, 1 / 3];
    const raster = Buffer.alloc(width * values.length * 4);
    for (let i = 0; i < width * values.length; i++) raster.writeUInt32BE(Math.round(values[i % values.length]! * maximum), i * 4);
    const expected = Buffer.concat([Buffer.from(`P7\nWIDTH ${width}\nHEIGHT 1\nDEPTH ${values.length}\nMAXVAL ${maximum}\nTUPLTYPE ${space === "cmyk" ? "CMYK" : space === "b-w" ? "GRAYSCALE" : "RGB"}_ALPHA\nENDHDR\n`), raster]);
    expect(Buffer.from(encodePpm(image, depth, false, true))).toEqual(expected);
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      const position = storage.allocate(data.length);
      await storage.write(position, data);
      const storedData16 = {position: storage.allocate(data16.byteLength), length: data16.length};
      await storage.write(storedData16.position, new Uint8Array(data16.buffer));
      const storedHueSamples = storage.allocate(hueSamples.byteLength);
      await storage.write(storedHueSamples, new Uint8Array(hueSamples.buffer));
      const chunks: Uint8Array[] = [];
      for await (const chunk of encodeNetpbmFromStorage({...image, position, ...(highDepth ? {storedData16} : {}), ...(space === "cmyk" ? {storedHueSamples} : {})}, storage, signal, "pam", depth)) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(expected);
    } finally {await storage.close();}
  });
}
