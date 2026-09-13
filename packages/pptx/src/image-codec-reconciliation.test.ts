import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { addImage } from "./image-insertion.js";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { opaqueContext as context } from "../tests/fixtures/opaque-deck.js";
import { inspectZip } from "../tests/zip-reader.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
import { Image } from "./image-value.js";
import { imageMetadata } from "./image-metadata.js";

function word(value: number): number[] {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}
function chunk(name: string, data: number[]): number[] {
  const payload = [...Array.from(name, (c) => c.charCodeAt(0)), ...data];
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return [...word(data.length), ...payload, ...word((crc ^ 0xffffffff) >>> 0)];
}
function png(width: number, height: number, density?: [number, number, number]): Uint8Array {
  return Uint8Array.from([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", [...word(width), ...word(height), 8, 6, 0, 0, 0]),
    ...(density ? chunk("pHYs", [...word(density[0]), ...word(density[1]), density[2]]) : []),
    ...chunk("IDAT", [120, 156, 3, 0, 0, 0, 0, 1]),
    ...chunk("IEND", [])
  ]);
}
function jpeg(
  width: number,
  height: number,
  density?: [number, number, number],
  marker = 192
): Uint8Array {
  return Uint8Array.from([
    255,
    216,
    ...(density
      ? [
          255,
          224,
          0,
          16,
          74,
          70,
          73,
          70,
          0,
          1,
          1,
          density[2],
          density[0] >>> 8,
          density[0] & 255,
          density[1] >>> 8,
          density[1] & 255,
          0,
          0
        ]
      : []),
    255,
    marker,
    0,
    11,
    8,
    height >>> 8,
    height & 255,
    width >>> 8,
    width & 255,
    1,
    1,
    17,
    0,
    255,
    217
  ]);
}
function tiff(
  width: number,
  height: number,
  density?: [number | null, number | null, number | null],
  little = true,
  scalarType = 4
): Uint8Array {
  const entries: [number, number, number][] = [
    [256, scalarType, width],
    [257, scalarType, height]
  ];
  if (density?.[0] !== undefined && density[0] !== null) entries.push([282, 4, density[0]]);
  if (density?.[1] !== undefined && density[1] !== null) entries.push([283, 4, density[1]]);
  if (density?.[2] !== undefined && density[2] !== null) entries.push([296, 3, density[2]]);
  const bytes = new Uint8Array(14 + entries.length * 12),
    view = new DataView(bytes.buffer);
  bytes.set(little ? [73, 73] : [77, 77]);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, entries.length, little);
  entries.forEach(([tag, type, value], index) => {
    const offset = 10 + index * 12;
    view.setUint16(offset, tag, little);
    view.setUint16(offset + 2, type, little);
    view.setUint32(offset + 4, 1, little);
    if (type === 3) view.setUint16(offset + 8, value, little);
    else view.setUint32(offset + 8, value, little);
  });
  return bytes;
}
function bitmap(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(54 + Math.ceil((width * 3) / 4) * 4 * height),
    view = new DataView(bytes.buffer);
  bytes.set([66, 77]);
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setInt32(38, 3780, true);
  view.setInt32(42, 3780, true);
  return bytes;
}
function gif(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    71,
    73,
    70,
    56,
    57,
    97,
    width & 255,
    width >>> 8,
    height & 255,
    height >>> 8,
    0,
    0,
    0,
    44,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    2,
    2,
    68,
    1,
    0,
    59
  ]);
}

it.each([
  ["bmp", bitmap(211, 71), "image/bmp", [211, 71], [96, 96]],
  ["gif", gif(290, 360), "image/gif", [290, 360], [72, 72]],
  ["jpg", jpeg(204, 204), "image/jpeg", [204, 204], [72, 72]],
  ["jpg", jpeg(1504, 1936, [300, 300, 1]), "image/jpeg", [1504, 1936], [300, 300]],
  ["png", png(150, 214), "image/png", [150, 214], [72, 72]],
  ["png", png(901, 1350, [5906, 5906, 1]), "image/png", [901, 1350], [150, 150]],
  ["png", png(860, 579, [11811, 11811, 1]), "image/png", [860, 579], [300, 300]],
  ["tiff", tiff(48, 48, [72, 72, 2]), "image/tiff", [48, 48], [72, 72]],
  ["tiff", tiff(2464, 3248, [300, 300, 2]), "image/tiff", [2464, 3248], [300, 300]]
] as const)(
  "characterizes authored %s dimensions and physical density",
  (ext, bytes, type, size, dpi) => {
    const value = new Image(bytes, "sample.bin");
    expect(value.ext).toBe(ext);
    expect(value.content_type).toBe(type);
    expect(value.size).toEqual(size);
    expect(value.dpi).toEqual(dpi);
    expect(value.filename).toBe("sample.bin");
    expect(value.blob).toEqual(bytes);
  }
);

it.each([
  [0, 72, 72],
  [1, 100, 200],
  [2, 254, 508]
] as const)("interprets JPEG density unit %i", (unit, x, y) => {
  expect(new Image(jpeg(42, 24, [100, 200, unit])).dpi).toEqual([x, y]);
});
it.each([
  [1, 150, 240, 72, 72],
  [2, 42, 24, 42, 24],
  [3, 100, 200, 254, 508],
  [2, null, null, 72, 72],
  [null, 96, 100, 96, 100]
] as const)(
  "interprets TIFF density unit %s and optional axes",
  (unit, x, y, expectedX, expectedY) => {
    expect(new Image(tiff(42, 24, [x, y, unit])).dpi).toEqual([expectedX, expectedY]);
  }
);
it.each([undefined, [1000, 1000, 0], [1000, 1000, 255], [0, 0, 1]] as const)(
  "defaults absent, unknown and zero PNG density %j",
  (density) => {
    expect(new Image(png(12, 34, density ? [...density] : undefined)).dpi).toEqual([72, 72]);
  }
);
it("converts each PNG physical axis independently", () => {
  const value = new Image(png(12, 34, [1654, 945, 1]));
  expect(value.size).toEqual([12, 34]);
  expect(value.dpi).toEqual([42, 24]);
});
it.each([true, false])(
  "reads sliced TIFF SHORT and LONG scalar fields in byte order %s",
  (little) => {
    for (const scalar of [3, 4]) {
      const bytes = tiff(42, 24, [96, 100, 2], little, scalar),
        storage = new Uint8Array(bytes.length + 7);
      storage.set(bytes, 7);
      const value = new Image(storage.subarray(7));
      expect(value.size).toEqual([42, 24]);
      expect(value.dpi).toEqual([96, 100]);
    }
  }
);
it.each([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207])(
  "reads JPEG frame marker %i",
  (marker) => {
    expect(new Image(jpeg(42, 24, undefined, marker)).size).toEqual([42, 24]);
  }
);
it("rejects ambient path and stream construction without invoking their methods", () => {
  let reads = 0;
  const stream = {
    read() {
      reads++;
      return jpeg(42, 24);
    }
  };
  for (const input of ["/image.jpg", stream])
    expect(() => new Image(input as unknown as Uint8Array)).toThrowError(
      expect.objectContaining({ code: "invalid-type" })
    );
  expect(reads).toBe(0);
});
it.each(["image.bin", null])("retains explicit optional image name %s", (name) => {
  expect(new Image(jpeg(42, 24), name).filename).toBe(name);
});
it("ignores non-density application metadata while preserving inert bytes", () => {
  const bytes = jpeg(42, 24),
    withMetadata = Uint8Array.from([
      255,
      216,
      255,
      225,
      0,
      8,
      78,
      111,
      116,
      69,
      88,
      70,
      ...bytes.subarray(2)
    ]);
  const value = new Image(withMetadata);
  expect(value.dpi).toEqual([72, 72]);
  expect(value.size).toEqual([42, 24]);
  expect(value.blob).toEqual(withMetadata);
});
it("keeps missing JPEG frame dimensions explicit instead of inventing a size", () => {
  const value = new Image(Uint8Array.from([255, 216, 255, 217]));
  expect(value.dpi).toEqual([72, 72]);
  expect(() => value.size).toThrowError(expect.objectContaining({ code: "invalid-value" }));
});
it.each([0, 1, 2, 3, 4, 6, 8])(
  "rejects malformed JPEG segment structure from supplied offset %i",
  (offset) => {
    const malformed = Uint8Array.from([255, 216, 255, 224, 0, 1, 255, 0, 255, 255, 255, 217]);
    expect(() => new Image(malformed.subarray(offset))).toThrow();
  }
);
it("does not read PNG density fields beyond a truncated chunk", () => {
  const bytes = png(12, 34, [1654, 945, 1]).subarray(0, 49);
  expect(imageMetadata(bytes, "image/png")).toEqual({
    pixelWidth: 12,
    pixelHeight: 34,
    dpiX: 72,
    dpiY: 72
  });
  expect(() => new Image(bytes)).toThrowError(expect.objectContaining({ code: "invalid-value" }));
});

it("uses the specified 72 DPI fallback for a bitmap axis with zero density", () => {
  const bytes = bitmap(26, 43),
    view = new DataView(bytes.buffer);
  view.setInt32(38, 7864, true);
  view.setInt32(42, 0, true);
  const value = new Image(bytes);
  expect(value.size).toEqual([26, 43]);
  expect(value.dpi).toEqual([200, 72]);
});
it("reads authored GIF and TIFF constructor dimensions without decoder proxies", () => {
  expect(new Image(gif(42, 24)).size).toEqual([42, 24]);
  const value = new Image(tiff(111, 222, [333, 444, 2]));
  expect(value.size).toEqual([111, 222]);
  expect(value.dpi).toEqual([333, 444]);
});
it.each([1, 2, 3, 4, 5, 6])(
  "preserves unrelated TIFF field type %i without exposing a decoder object",
  (type) => {
    const base = tiff(42, 24),
      bytes = new Uint8Array(base.length + 20),
      view = new DataView(bytes.buffer);
    bytes.set(base);
    view.setUint16(8, 3, true);
    view.setUint16(34, 65000, true);
    view.setUint16(36, type, true);
    view.setUint32(38, 1, true);
    if (type === 5) {
      view.setUint32(42, 50, true);
      view.setUint32(50, 42, true);
      view.setUint32(54, 84, true);
    } else view.setUint32(42, 42, true);
    const value = new Image(bytes);
    expect(value.size).toEqual([42, 24]);
    expect(value.blob).toEqual(bytes);
  }
);
it("preserves an inert terminated TIFF text field without evaluating it", () => {
  const base = tiff(42, 24),
    bytes = new Uint8Array(57),
    view = new DataView(bytes.buffer);
  bytes.set(base);
  view.setUint16(8, 3, true);
  view.setUint16(34, 270, true);
  view.setUint16(36, 2, true);
  view.setUint32(38, 7, true);
  view.setUint32(42, 50, true);
  bytes.set(new TextEncoder().encode("note42\0"), 50);
  const value = new Image(bytes);
  expect(value.blob.subarray(50)).toEqual(Uint8Array.from([110, 111, 116, 101, 52, 50, 0]));
  expect(value.size).toEqual([42, 24]);
});

it.each([
  [undefined, undefined, 2590800, 2590800],
  [1000, undefined, 1000, 1000],
  [undefined, 3000, 3000, 3000],
  [3337, 9999, 3337, 9999]
] as const)(
  "serializes square image sizing %s by %s through SDK and CLI",
  async (width, height, expectedWidth, expectedHeight) => {
    const bytes = jpeg(204, 204),
      input = await createPresentation({ slides: [{}] }, context);
    const sdk = await addImage(
      input,
      {
        slide: 1,
        bytes,
        contentType: "image/jpeg",
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height })
      },
      context
    );
    const volume = Volume.fromJSON({
      "/deck.pptx": Buffer.from(input),
      "/asset.jpg": Buffer.from(bytes)
    });
    const args = [
      "images",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--file",
      "/asset.jpg",
      "--output",
      "/out.pptx",
      "--json"
    ];
    if (width !== undefined) args.push("--width", `${width}emu`);
    if (height !== undefined) args.push("--height", `${height}emu`);
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 8192,
      maxOutputBytes: 131072
    });
    const result = await engine.execute({
      args: args.map((value) => new TextEncoder().encode(value)),
      signal: new AbortController().signal,
      async readInput(path) {
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      },
      async publishOutput(publication) {
        volume.writeFileSync(publication.outputPath, publication.bytes);
      }
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    for (const output of [sdk, new Uint8Array(volume.readFileSync("/out.pptx") as Buffer)]) {
      const entries = inspectZip(output),
        slide = entries.find((entry) => entry.name === "ppt/slides/slide1.xml")!;
      const dimensions: Record<string, string>[] = [],
        parser = new SaxesParser({ xmlns: true });
      parser.on("opentag", (tag) => {
        if (
          tag.local === "ext" &&
          tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main"
        )
          dimensions.push(
            Object.fromEntries(
              Object.values(tag.attributes).map((attribute) => [attribute.local, attribute.value])
            )
          );
      });
      parser.write(new TextDecoder().decode(slide.payload)).close();
      expect(dimensions.at(-1)).toEqual({ cx: String(expectedWidth), cy: String(expectedHeight) });
      expect(entries.find((entry) => entry.name === "ppt/media/image1.jpg")?.payload).toEqual(
        bytes
      );
    }
  }
);

function wmf(): Uint8Array {
  const bytes = new Uint8Array(46),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x9ac6cdd7, true);
  view.setInt16(10, 420, true);
  view.setInt16(12, 240, true);
  view.setUint16(14, 720, true);
  let checksum = 0;
  for (let offset = 0; offset < 20; offset += 2) checksum ^= view.getUint16(offset, true);
  view.setUint16(20, checksum, true);
  view.setUint16(22, 1, true);
  view.setUint16(24, 9, true);
  view.setUint16(26, 0x300, true);
  view.setUint32(28, 12, true);
  view.setUint32(34, 3, true);
  view.setUint32(40, 3, true);
  return bytes;
}
it.each([
  ["gif", gif(42, 24)],
  ["jpg", jpeg(42, 24)],
  ["png", png(42, 24)],
  ["tiff", tiff(42, 24)],
  ["wmf", wmf()],
  ["bmp", bitmap(42, 24)]
] as const)(
  "inserts and preserves authored %s bytes through explicit CLI file capability",
  async (ext, bytes) => {
    const input = await createPresentation({ slides: [{}] }, context);
    const volume = Volume.fromJSON({
      "/deck.pptx": Buffer.from(input),
      [`/asset.${ext}`]: Buffer.from(bytes)
    });
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 8192,
      maxOutputBytes: 131072
    });
    const result = await engine.execute({
      args: [
        "images",
        "add",
        "/deck.pptx",
        "--slide",
        "1",
        "--file",
        `/asset.${ext}`,
        "--output",
        "/out.pptx",
        "--json"
      ].map((value) => new TextEncoder().encode(value)),
      signal: new AbortController().signal,
      async readInput(path) {
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      },
      async publishOutput(publication) {
        volume.writeFileSync(publication.outputPath, publication.bytes);
      }
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    const entries = inspectZip(new Uint8Array(volume.readFileSync("/out.pptx") as Buffer));
    expect(entries.find((entry) => entry.name === `ppt/media/image1.${ext}`)?.payload).toEqual(
      bytes
    );
    const value = new Image(bytes);
    expect(value.ext).toBe(ext);
    expect(value.size).toEqual([42, 24]);
  }
);
it("rejects unsupported enhanced metafile admission with an explicit profile error", () => {
  const bytes = new Uint8Array(88),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 88, true);
  view.setUint32(40, 0x464d4520, true);
  expect(() => new Image(bytes)).toThrowError(
    expect.objectContaining({ code: "unsupported-profile" })
  );
});

it.each([
  [undefined, undefined, 1000, 2000],
  [100, undefined, 100, 200],
  [undefined, 500, 250, 500],
  [1500, 1500, 1500, 1500]
] as const)(
  "serializes tall image sizing %s by %s with independent expected geometry",
  async (width, height, expectedWidth, expectedHeight) => {
    const bytes = tiff(2, 4, [1829, 1829, 2]),
      input = await createPresentation({ slides: [{}] }, context);
    const output = await addImage(
      input,
      {
        slide: 1,
        bytes,
        contentType: "image/tiff",
        ...(width === undefined ? {} : { width }),
        ...(height === undefined ? {} : { height })
      },
      context
    );
    const volume = Volume.fromJSON({
      "/deck.pptx": Buffer.from(input),
      "/asset.tiff": Buffer.from(bytes)
    });
    const args = [
      "images",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--file",
      "/asset.tiff",
      "--output",
      "/out.pptx",
      "--json"
    ];
    if (width !== undefined) args.push("--width", `${width}emu`);
    if (height !== undefined) args.push("--height", `${height}emu`);
    const engine = createPptxCommandEngine({
      context,
      maxArgumentBytes: 8192,
      maxOutputBytes: 131072
    });
    const result = await engine.execute({
      args: args.map((value) => new TextEncoder().encode(value)),
      signal: new AbortController().signal,
      async readInput(path) {
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      },
      async publishOutput(publication) {
        volume.writeFileSync(publication.outputPath, publication.bytes);
      }
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    for (const packageBytes of [
      output,
      new Uint8Array(volume.readFileSync("/out.pptx") as Buffer)
    ]) {
      const slide = inspectZip(packageBytes).find(
        (entry) => entry.name === "ppt/slides/slide1.xml"
      )!;
      const dimensions: Record<string, string>[] = [],
        parser = new SaxesParser({ xmlns: true });
      parser.on("opentag", (tag) => {
        if (
          tag.local === "ext" &&
          tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main"
        )
          dimensions.push(
            Object.fromEntries(
              Object.values(tag.attributes).map((attribute) => [attribute.local, attribute.value])
            )
          );
      });
      parser.write(new TextDecoder().decode(slide.payload)).close();
      expect(dimensions.at(-1)).toEqual({ cx: String(expectedWidth), cy: String(expectedHeight) });
    }
  }
);
it("serializes unequal physical density axes without assuming square pixels", async () => {
  const bytes = jpeg(150, 75, [72, 200, 1]),
    input = await createPresentation({ slides: [{}] }, context);
  const output = await addImage(input, { slide: 1, bytes, contentType: "image/jpeg" }, context);
  const slide = inspectZip(output).find((entry) => entry.name === "ppt/slides/slide1.xml")!;
  const dimensions: Record<string, string>[] = [],
    parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === "ext" && tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main")
      dimensions.push(
        Object.fromEntries(
          Object.values(tag.attributes).map((attribute) => [attribute.local, attribute.value])
        )
      );
  });
  parser.write(new TextDecoder().decode(slide.payload)).close();
  expect(dimensions.at(-1)).toEqual({ cx: "1905000", cy: "342900" });
});
