import { describe, expect, it } from "vitest";
import { admitImage } from "./image-admission.js";

function chunk(name: string, data: number[]): number[] {
  const payload = [...Array.from(name, (c) => c.charCodeAt(0)), ...data];
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  return [...word(data.length), ...payload, ...word(crc)];
}
function word(n: number): number[] {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function png(width = 2, height = 3, depth = 8, color = 6): Uint8Array {
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...chunk("IHDR", [...word(width), ...word(height), depth, color, 0, 0, 0]),
    ...chunk("IDAT", [120, 156, 3, 0, 0, 0, 0, 1]),
    ...chunk("IEND", [])
  ]);
}
function gif(width = 2, height = 3): Uint8Array {
  return new Uint8Array([
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
    width & 255,
    width >>> 8,
    height & 255,
    height >>> 8,
    0,
    2,
    2,
    68,
    1,
    0,
    59
  ]);
}
function jpeg(width = 2, height = 3): Uint8Array {
  return new Uint8Array([
    255,
    216,
    255,
    192,
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

describe("explicit image admission", () => {
  it.each([null, 7, { toString: () => "image/png" }])(
    "rejects non-string MIME without coercion",
    (type) => {
      expect(() => admitImage(png(), type as unknown as string)).toThrow();
    }
  );
  it.each([
    ["image/png", png(), "png"],
    ["image/gif", gif(), "gif"],
    ["image/jpeg", jpeg(), "jpg"]
  ] as const)("reads %s intrinsic dimensions", (type, bytes, extension) => {
    expect(admitImage(bytes, type)).toEqual({
      pixelWidth: 2,
      pixelHeight: 3,
      dpiX: 72,
      dpiY: 72,
      extension
    });
  });
  it("checks metadata after entropy data without decoding it", () => {
    const bytes = new Uint8Array([
      255,
      216,
      255,
      218,
      0,
      8,
      1,
      1,
      0,
      0,
      63,
      0,
      17,
      255,
      0,
      18,
      ...jpeg(0, 3).subarray(2)
    ]);
    expect(() => admitImage(bytes, "image/jpeg")).toThrow();
  });
  it("rejects invalid PNG chunk names and header methods", () => {
    const header = [...word(2), ...word(3), 8, 6, 1, 0, 0];
    const bytes = new Uint8Array([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      ...chunk("IHDR", header),
      ...chunk("IDAT", [1]),
      ...chunk("IEND", [])
    ]);
    expect(() => admitImage(bytes, "image/png")).toThrow();
    const malformed = new Uint8Array([
      ...png().subarray(0, 33),
      ...chunk("a1cd", []),
      ...png().subarray(33)
    ]);
    expect(() => admitImage(malformed, "image/png")).toThrow();
  });
  it("preserves alpha and compressed bytes without decoding", () => {
    const bytes = png();
    const before = bytes.slice();
    expect(admitImage(bytes, "image/png").pixelWidth).toBe(2);
    expect(bytes).toEqual(before);
  });
  it("honors sliced byte views", () => {
    const bytes = png();
    const buffer = new Uint8Array(bytes.length + 5);
    buffer.set(bytes, 5);
    expect(admitImage(buffer.subarray(5), "image/png").pixelHeight).toBe(3);
  });
  it.each(["image/bmp", "image/svg+xml", "image/png; charset=utf-8", "IMAGE/PNG", ""])(
    "rejects unsupported content type %s",
    (type) => {
      expect(() => admitImage(png(), type)).toThrow();
    }
  );
  it.each([new Uint8Array(), new Uint8Array([137, 80, 78]), gif(), jpeg()])(
    "rejects malformed or mismatched PNG signature",
    (bytes) => {
      expect(() => admitImage(bytes, "image/png")).toThrow();
    }
  );
  it.each([
    [0, 1],
    [1, 0],
    [1000001, 1],
    [10001, 10000]
  ])("rejects unsafe dimensions %i by %i", (width, height) => {
    expect(() => admitImage(png(width, height), "image/png")).toThrow();
  });
  it("allows bounded extreme aspect ratios", () => {
    expect(admitImage(png(1000000, 1), "image/png").pixelWidth).toBe(1000000);
  });
  it.each([
    [1, 6],
    [4, 2],
    [16, 3],
    [8, 1],
    [8, 5]
  ])("rejects illegal PNG depth/color %i/%i", (depth, color) => {
    expect(() => admitImage(png(2, 3, depth, color), "image/png")).toThrow();
  });
  it("rejects corrupt CRC and truncated chunks", () => {
    const bytes = png();
    bytes[29] = bytes[29]! ^ 1;
    expect(() => admitImage(bytes, "image/png")).toThrow();
    expect(() => admitImage(png().subarray(0, 40), "image/png")).toThrow();
  });
  it("rejects payloads above the encoded-byte budget", () => {
    expect(() => admitImage(new Uint8Array(32 * 1024 * 1024 + 1), "image/png")).toThrow();
  });
  it.each([gif(0, 3), gif().subarray(0, 20), new Uint8Array([...gif().subarray(0, 29), 255, 59])])(
    "rejects malformed GIF containers",
    (bytes) => {
      expect(() => admitImage(bytes, "image/gif")).toThrow();
    }
  );
  it.each([
    jpeg(0, 3),
    jpeg().subarray(0, 12),
    new Uint8Array([255, 216, 255, 224, 255, 255, 255, 217])
  ])("rejects malformed JPEG frames and segments", (bytes) => {
    expect(() => admitImage(bytes, "image/jpeg")).toThrow();
  });
  it("retains unknown dimensions for a bounded JPEG without a supported frame", () => {
    expect(admitImage(new Uint8Array([255, 216, 255, 217]), "image/jpeg")).toEqual({
      pixelWidth: null,
      pixelHeight: null,
      dpiX: 72,
      dpiY: 72,
      extension: "jpg"
    });
  });
});
