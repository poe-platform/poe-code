import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import type {RgbaImage} from "../ast.js";
import {encodePpm, encodePgm, encodePbm} from "./netpbm.js";
import {encodeNetpbmFromStorage} from "./netpbm-storage.js";

it.each(["ppm", "pgm"] as const)("writes exact big-endian %s samples in both output paths", async format => {
  for (const depth of [undefined, 1, 4, 8, 9, 10, 16, 17, 24, 32]) for (const highDepth of [true, false]) for (const width of [2, 1026]) {
    const data16 = Uint16Array.from({length: width * 4}, (_, i) => [0x1234, 0x4567, 0x89ab, 65535, 0xcdef, 0x1379, 0x2468, 65535][i % 8]!);
    const data = Uint8Array.from(data16, value => Math.round(value / 257));
    const image: RgbaImage = {width, height: 1, data, ...(highDepth ? {data16} : {}), format: "png", depth: highDepth ? "ushort" : "uchar", space: "srgb", channels: 3, density: 72, hasAlpha: false};
    const samples = highDepth ? data16 : data;
    const values = Array.from({length: width}, (_, pixel) => format === "ppm" ? Array.from(samples.subarray(pixel * 4, pixel * 4 + 3)) : [.212656 * samples[pixel*4]! + .715158 * samples[pixel*4+1]! + .072186 * samples[pixel*4+2]!]).flat();
    const maximum = 2 ** (depth ?? (highDepth ? 16 : 8)) - 1;
    const sampleBytes = maximum > 65535 ? 4 : maximum > 255 ? 2 : 1;
    const raster = Buffer.alloc(values.length * sampleBytes);
    values.forEach((value, i) => {
      const scaled = Math.round(value * maximum / (highDepth ? 65535 : 255));
      raster.writeUIntBE(scaled, i * sampleBytes, sampleBytes);
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

it.each(["ppm", "pam", "pgm", "pbm"] as const)("writes %s comments without changing raster bytes", async format => {
  for (const comment of [undefined, "", "caption A\ncaption B", "café\n画像", "end\n", "a\r\nb"]) for (const ascii of [false, true]) {
    const image: RgbaImage = {width: 2, height: 1, data: Uint8Array.from([18, 52, 86, 255, 171, 205, 239, 255]), format: "png", depth: "uchar", space: "srgb", channels: 3, density: 72, hasAlpha: false};
    const encode = (input: RgbaImage) => format === "pbm" ? encodePbm(input, ascii) : format === "pgm" ? encodePgm(input, 8, ascii) : encodePpm(input, 8, ascii, format === "pam");
    const baseline = encode(image);
    image.properties = comment === undefined ? {} : {comment};
    const expected = Buffer.concat([baseline.subarray(0, 3), Buffer.from(comment ? comment.split("\n").map(line => `#${line.split("\r").join("\r#")}\n`).join("") : ""), baseline.subarray(3)]);
    expect(Buffer.from(encode(image))).toEqual(expected);
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      const position = storage.allocate(image.data.length);
      await storage.write(position, image.data);
      const chunks: Uint8Array[] = [];
      for await (const chunk of encodeNetpbmFromStorage({...image, position}, storage, signal, format, 8, ascii)) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(expected);
    } finally {await storage.close();}
  }
});

it.each(["ppm", "pgm", "pbm"] as const)("groups plain %s rows in both output paths", async format => {
  for (const highDepth of [false, true]) for (const width of [2, 513]) {
    const data = width === 2 ? Uint8Array.from([255,255,255,255,0,0,0,255,0,0,0,255,255,255,255,255]) : new Uint8Array(width * 2 * 4).fill(255);
    const data16 = Uint16Array.from(data, value => value * 257);
    const image: RgbaImage = {width, height: 2, data, ...(highDepth ? {data16} : {}), format: "png", depth: "uchar", space: "srgb", channels: 3, density: 72, hasAlpha: false};
    let expected = format === "ppm" ? "P3\n2 2\n255\n255 255 255 0 0 0\n0 0 0 255 255 255\n" : format === "pgm" ? "P2\n2 2\n255\n255 0\n0 255\n" : "P1\n2 2\n0 1\n1 0\n";
    if (width !== 2) {
      const pixel = format === "ppm" ? "255 255 255" : format === "pgm" ? "255" : "0";
      const perLine = format === "ppm" ? 5 : format === "pgm" ? 17 : 35;
      const lines: string[] = [];
      for (let left = width * 2; left > 0; left -= perLine) lines.push(Array(Math.min(left, perLine)).fill(pixel).join(" "));
      expected = `${format === "ppm" ? "P3" : format === "pgm" ? "P2" : "P1"}\n${width} 2\n${format === "pbm" ? "" : "255\n"}${lines.join("\n")}\n`;
    }
    expect(Buffer.from(format === "ppm" ? encodePpm(image, 8, true) : format === "pgm" ? encodePgm(image, 8, true) : encodePbm(image, true)).toString()).toBe(expected);
    const signal = new AbortController().signal;
    const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd: "/", env: {}, signal}, 1);
    try {
      const position = storage.allocate(data.length);
      await storage.write(position, data);
      const storedData16 = {position: storage.allocate(data16.byteLength), length: data16.length};
      await storage.write(storedData16.position, new Uint8Array(data16.buffer));
      const chunks: Uint8Array[] = [];
      for await (const chunk of encodeNetpbmFromStorage({...image, position, ...(highDepth ? {storedData16} : {})}, storage, signal, format, 8, true)) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe(expected);
    } finally {await storage.close();}
  }
});
