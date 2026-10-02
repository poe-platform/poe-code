import { expect, it } from "vitest";
import { Volume } from "memfs";
import { Image, InputTypeError } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
import {
  rasterPng,
  rasterJpeg,
  rasterGif,
  rasterBmp,
  rasterTiff,
  rasterDirectory,
  pngChunk,
  jpegSegment,
  joinBytes
} from "../tests/fixtures/raster.js";

async function admit(bytes: Uint8Array, filename?: string): Promise<Image> {
  const path = "/media/" + (filename ?? "payload"),
    volume = Volume.fromJSON({ [path]: Buffer.from(bytes) });
  if (filename)
    return Image.from_file(
      { path, capability: "media" },
      {
        ...textContext,
        binaryResolver: {
          capability: "media",
          async *open(request) {
            yield new Uint8Array(volume.readFileSync(request) as Buffer);
          }
        }
      }
    );
  return Image.from_blob(new Uint8Array(volume.readFileSync(path) as Buffer), textContext);
}
function gif(width: number, height: number): Uint8Array {
  const bytes = rasterGif();
  const view = new DataView(bytes.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bytes;
}
function directory(
  little: boolean,
  width: number,
  height: number,
  unit: number | null,
  x: number | null,
  y: number | null
): Uint8Array {
  return rasterDirectory(little, [
    { tag: 256, type: 3, values: [width] },
    { tag: 257, type: 4, values: [height] },
    ...(unit === null ? [] : [{ tag: 296, type: 3, values: [unit] }]),
    ...(x === null ? [] : [{ tag: 282, type: 5, values: [x] }]),
    ...(y === null ? [] : [{ tag: 283, type: 5, values: [y] }])
  ]);
}

it("BMP admission extracts dimensions and density", async () => {
  const image = await admit(rasterBmp(26, 43, 7864, 0));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/bmp", "bmp", 26, 43, 199.7456, 72]);
});

it("BMP MIME follows the signature", async () => {
  const image = await admit(rasterBmp(26, 43, 7864, 0));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/bmp", "bmp", 26, 43, 199.7456, 72]);
});

it("BMP anonymous suffix follows the signature", async () => {
  const image = await admit(rasterBmp(26, 43, 7864, 0));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/bmp", "bmp", 26, 43, 199.7456, 72]);
});

it("GIF admission extracts dimensions and density", async () => {
  const image = await admit(gif(42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/gif", "gif", 42, 24, 72, 72]);
});

it("GIF MIME follows the signature", async () => {
  const image = await admit(gif(42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/gif", "gif", 42, 24, 72, 72]);
});

it("GIF anonymous suffix follows the signature", async () => {
  const image = await admit(gif(42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/gif", "gif", 42, 24, 72, 72]);
});

it("Offset signature reads ignore unrelated backing bytes", async () => {
  const payload = rasterPng(42, 24);
  const backing = joinBytes(Uint8Array.of(31, 47, 59), payload, Uint8Array.of(83));
  const image = await admit(backing.subarray(3, -1));
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
});

it("Truncated integer intervals reject through header admission", async () => {
  await expect(
    admit(
      rasterDirectory(false, [
        { tag: 256, type: 4, values: [42] },
        { tag: 257, type: 4, values: [24] }
      ]).slice(0, 15)
    )
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("big endian unsigned values survive bounded header reads", async () => {
  const image = await admit(
    joinBytes(
      new Uint8Array(1).fill(31),
      rasterDirectory(false, [
        { tag: 256, type: 4, values: [42] },
        { tag: 257, type: 3, values: [24] }
      ])
    ).subarray(1)
  );
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 72, 72]);
});

it("little endian unsigned values survive bounded header reads", async () => {
  const image = await admit(
    joinBytes(
      new Uint8Array(2).fill(31),
      rasterDirectory(true, [
        { tag: 256, type: 4, values: [42] },
        { tag: 257, type: 3, values: [24] }
      ])
    ).subarray(2)
  );
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 72, 72]);
});

it("Blob admission snapshots caller bytes before awaiting", async () => {
  const bytes = rasterPng(42, 24),
    original = new Uint8Array(bytes),
    volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  const input = new Uint8Array(volume.readFileSync("/media") as Buffer),
    pending = Image.from_blob(input, textContext);
  input.fill(0);
  const image = await pending,
    copy = image.blob;
  copy.fill(1);
  expect(image.blob).toEqual(original);
  expect(image.blob).not.toBe(input);
});

it("Capability input retains the basename", async () => {
  const image = await admit(rasterPng(42, 24), "harbor.png");
  expect(image.filename).toBe("harbor.png");
  expect(image.ext).toBe("png");
});

it("Explicit byte source closes after complete admission", async () => {
  const bytes = rasterPng(42, 24),
    volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              yield new Uint8Array(volume.readFileSync("/media") as Buffer);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.filename).toBe("image.png");
  expect(image.blob).toEqual(bytes);
  expect(closed).toBe(true);
});

it("Named stream equivalent uses an explicit VFS basename", async () => {
  const image = await admit(rasterPng(42, 24), "harbor.png");
  expect(image.filename).toBe("harbor.png");
  expect(image.ext).toBe("png");
});

it("Anonymous source receives a canonical basename", async () => {
  const bytes = rasterPng(42, 24),
    volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              yield new Uint8Array(volume.readFileSync("/media") as Buffer);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.filename).toBe("image.png");
  expect(image.blob).toEqual(bytes);
  expect(closed).toBe(true);
});

it("Blob getters return independent owned bytes", async () => {
  const bytes = rasterPng(42, 24),
    original = new Uint8Array(bytes),
    volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  const input = new Uint8Array(volume.readFileSync("/media") as Buffer),
    pending = Image.from_blob(input, textContext);
  input.fill(0);
  const image = await pending,
    copy = image.blob;
  copy.fill(1);
  expect(image.blob).toEqual(original);
  expect(image.blob).not.toBe(input);
});

it("Admitted MIME is derived from bytes", async () => {
  const image = await admit(rasterJpeg(111, 222, [1, 333, 444]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 111, 222, 333, 444]);
});

it("Pixel dimensions remain independent axes", async () => {
  const image = await admit(rasterJpeg(111, 222, [1, 333, 444]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 111, 222, 333, 444]);
});

it("DPI metadata remains independent axes", async () => {
  const image = await admit(rasterJpeg(111, 222, [1, 333, 444]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 111, 222, 333, 444]);
});

it("Unequal axis density controls native physical size", async () => {
  const image = await admit(rasterJpeg(150, 75, [1, 72, 200]));
  expect([image.width.emu, image.height.emu]).toEqual([1905000, 342900]);
  expect([image.width.unit, image.height.unit]).toEqual(["in", "in"]);
});

it("Physical scaling with width null and height null", async () => {
  const image = await admit(rasterJpeg(10, 20, [1, 9144, 9144]));
  expect(image.scaled_dimensions(null, null).map((value) => value.emu)).toEqual([1000, 2000]);
  expect(Object.isFrozen(image.scaled_dimensions(null, null))).toBe(true);
});

it("Physical scaling with width 100 and height null", async () => {
  const image = await admit(rasterJpeg(10, 20, [1, 9144, 9144]));
  expect(image.scaled_dimensions(100, null).map((value) => value.emu)).toEqual([100, 200]);
  expect(Object.isFrozen(image.scaled_dimensions(100, null))).toBe(true);
});

it("Physical scaling with width null and height 500", async () => {
  const image = await admit(rasterJpeg(10, 20, [1, 9144, 9144]));
  expect(image.scaled_dimensions(null, 500).map((value) => value.emu)).toEqual([250, 500]);
  expect(Object.isFrozen(image.scaled_dimensions(null, 500))).toBe(true);
});

it("Physical scaling with width 1500 and height 1500", async () => {
  const image = await admit(rasterJpeg(10, 20, [1, 9144, 9144]));
  expect(image.scaled_dimensions(1500, 1500).map((value) => value.emu)).toEqual([1500, 1500]);
  expect(Object.isFrozen(image.scaled_dimensions(1500, 1500))).toBe(true);
});

it("Explicit filename survives admission", async () => {
  const image = await admit(rasterPng(42, 24), "harbor.png");
  expect(image.filename).toBe("harbor.png");
  expect(image.ext).toBe("png");
});

it("Named input retains its final filename suffix", async () => {
  const image = await admit(rasterPng(42, 24), "harbor.png");
  expect(image.filename).toBe("harbor.png");
  expect(image.ext).toBe("png");
});

it("Compatibility digest follows exact original admitted bytes", async () => {
  const image = await admit(rasterPng());
  expect(image.sha1).toBe("4c5fb6b51d61dfb4c66132d05f455ffbebf13028");
});

it("BMP 211 by 71 metadata from original header bytes", async () => {
  const image = await admit(rasterBmp(211, 71, 3780, 3780));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/bmp", "bmp", 211, 71, 3780 * 0.0254, 3780 * 0.0254]);
});

it("GIF 290 by 360 metadata from original header bytes", async () => {
  const image = await admit(gif(290, 360));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/gif", "gif", 290, 360, 72, 72]);
});

it("JPEG 204 by 204 metadata from original header bytes", async () => {
  const image = await admit(rasterJpeg(204, 204, [1, 72, 72]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 204, 204, 72, 72]);
});

it("JPEG 1504 by 1936 metadata from original header bytes", async () => {
  const image = await admit(rasterJpeg(1504, 1936, [1, 300, 300]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 1504, 1936, 300, 300]);
});

it("PNG 150 by 214 metadata from original header bytes", async () => {
  const image = await admit(rasterPng(150, 214));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 150, 214, 72, 72]);
});

it("PNG 901 by 1350 metadata from original header bytes", async () => {
  const image = await admit(rasterPng(901, 1350, [5906, 5906, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 901, 1350, 5906 * 0.0254, 5906 * 0.0254]);
});

it("PNG 860 by 579 metadata from original header bytes", async () => {
  const image = await admit(rasterPng(860, 579, [11811, 11811, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 860, 579, 11811 * 0.0254, 11811 * 0.0254]);
});

it("TIFF 48 by 48 metadata from original header bytes", async () => {
  const image = await admit(directory(true, 48, 48, 2, 72, 72));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 48, 48, 72, 72]);
});

it("TIFF 2464 by 3248 metadata from original header bytes", async () => {
  const image = await admit(directory(true, 2464, 3248, 2, 300, 300));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 2464, 3248, 300, 300]);
});

it("Fragmented png source consumes owned bytes from its explicit origin", async () => {
  const bytes = rasterPng(42, 24, [1417, 2480, 1]);
  const volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              const source = new Uint8Array(volume.readFileSync("/media") as Buffer);
              yield source.slice(0, 7);
              yield source.slice(7);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.blob).toEqual(bytes);
  expect(image.content_type).toBe("image/png");
  expect(closed).toBe(true);
});

it("Fragmented jpeg-jfif source consumes owned bytes from its explicit origin", async () => {
  const bytes = rasterJpeg(111, 222, [1, 333, 444]);
  const volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              const source = new Uint8Array(volume.readFileSync("/media") as Buffer);
              yield source.slice(0, 7);
              yield source.slice(7);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.blob).toEqual(bytes);
  expect(image.content_type).toBe("image/jpeg");
  expect(closed).toBe(true);
});

it("Fragmented jpeg-exif source consumes owned bytes from its explicit origin", async () => {
  const bytes = rasterJpeg(111, 222, [0, 1, 1], directory(false, 42, 24, 2, 333, 444));
  const volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              const source = new Uint8Array(volume.readFileSync("/media") as Buffer);
              yield source.slice(0, 7);
              yield source.slice(7);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.blob).toEqual(bytes);
  expect(image.content_type).toBe("image/jpeg");
  expect(closed).toBe(true);
});

it("Fragmented gif source consumes owned bytes from its explicit origin", async () => {
  const bytes = gif(42, 24);
  const volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              const source = new Uint8Array(volume.readFileSync("/media") as Buffer);
              yield source.slice(0, 7);
              yield source.slice(7);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.blob).toEqual(bytes);
  expect(image.content_type).toBe("image/gif");
  expect(closed).toBe(true);
});

it("Fragmented tiff source consumes owned bytes from its explicit origin", async () => {
  const bytes = directory(false, 42, 24, 2, 42, 24);
  const volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              const source = new Uint8Array(volume.readFileSync("/media") as Buffer);
              yield source.slice(0, 7);
              yield source.slice(7);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.blob).toEqual(bytes);
  expect(image.content_type).toBe("image/tiff");
  expect(closed).toBe(true);
});

it("Fragmented tiff-little-endian source consumes owned bytes from its explicit origin", async () => {
  const bytes = directory(true, 42, 24, 2, 42, 24);
  const volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              const source = new Uint8Array(volume.readFileSync("/media") as Buffer);
              yield source.slice(0, 7);
              yield source.slice(7);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.blob).toEqual(bytes);
  expect(image.content_type).toBe("image/tiff");
  expect(closed).toBe(true);
});

it("Fragmented bmp source consumes owned bytes from its explicit origin", async () => {
  const bytes = rasterBmp(26, 43, 7864, 0);
  const volume = Volume.fromJSON({ "/media": Buffer.from(bytes) });
  let closed = false;
  const image = await Image.from_file(
    {
      open() {
        return {
          async *[Symbol.asyncIterator]() {
            try {
              const source = new Uint8Array(volume.readFileSync("/media") as Buffer);
              yield source.slice(0, 7);
              yield source.slice(7);
            } finally {
              closed = true;
            }
          }
        };
      }
    },
    textContext
  );
  expect(image.blob).toEqual(bytes);
  expect(image.content_type).toBe("image/bmp");
  expect(closed).toBe(true);
});

it("Unknown image signatures fail asynchronous admission", async () => {
  await expect(admit(Uint8Array.of(19, 37, 71, 113))).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});

it("Unadmitted MIME cannot be manufactured by construction", async () => {
  const volume = Volume.fromJSON({ "/media": Buffer.from(rasterPng()) });
  const RuntimeImage = Image as unknown as new (data: unknown) => Image;
  expect(
    () =>
      new RuntimeImage({
        bytes: new Uint8Array(volume.readFileSync("/media") as Buffer),
        filename: null,
        context: textContext
      })
  ).toThrow(InputTypeError);
});

it("Unadmitted extension cannot be manufactured by construction", async () => {
  const volume = Volume.fromJSON({ "/media": Buffer.from(rasterPng()) });
  const RuntimeImage = Image as unknown as new (data: unknown) => Image;
  expect(
    () =>
      new RuntimeImage({
        bytes: new Uint8Array(volume.readFileSync("/media") as Buffer),
        filename: null,
        context: textContext
      })
  ).toThrow(InputTypeError);
});

it("Base dimension observations use admitted values", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("Base axis observations use admitted values", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG signature MIME", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG canonical suffix", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG embedded-directory owned metadata extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [0, 1, 1], directory(false, 42, 24, 2, 42, 24)));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG application-header owned metadata extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG segment collection owned metadata extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG segment collection APP0 density location", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG segment collection APP1 density location", async () => {
  const image = await admit(rasterJpeg(42, 24, [0, 1, 1], directory(false, 42, 24, 2, 42, 24)));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG missing optional APP0 retains dimensions", async () => {
  const image = await admit(
    joinBytes(rasterJpeg(42, 24).slice(0, 2), rasterJpeg(42, 24).slice(20))
  );
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 72, 72]);
});

it("JPEG missing optional APP1 retains dimensions", async () => {
  const image = await admit(rasterJpeg(42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 72, 72]);
});

it("JPEG segment collection frame location", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG missing frame rejects before a scan", async () => {
  const source = rasterJpeg();
  await expect(admit(joinBytes(source.slice(0, 20), source.slice(33)))).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});

it("JPEG segment role segment setting 0", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG segment role segment setting 1", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG density segment owned metadata extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG density variant setting 0", async () => {
  const image = await admit(rasterJpeg(42, 24, [0, 100, 200]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 72, 72]);
});

it("JPEG density variant setting 1", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 100, 200]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 100, 200]);
});

it("JPEG density variant setting 2", async () => {
  const image = await admit(rasterJpeg(42, 24, [2, 100, 200]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 254, 508]);
});

it("JPEG directory segment owned metadata extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [0, 1, 1], directory(false, 42, 24, 2, 42, 24)));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG non-Exif APP1 metadata remains inert", async () => {
  const image = await admit(
    joinBytes(
      rasterJpeg(42, 24).slice(0, 2),
      jpegSegment(225, Uint8Array.of(77, 97, 112, 108, 101, 0)),
      rasterJpeg(42, 24).slice(2)
    )
  );
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 72, 72]);
});

it("JPEG directory segment embedded directory density extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [0, 1, 1], directory(false, 42, 24, 2, 42, 24)));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG embedded resolution retains unequal axes", async () => {
  const image = await admit(rasterJpeg(42, 24, [0, 1, 1], directory(false, 42, 24, 2, 42, 24)));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG frame segment owned metadata extraction", async () => {
  const image = await admit(rasterJpeg(24, 42, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 24, 42, 42, 24]);
});

it("JPEG frame segment frame dimension extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG signature dispatch marker role \\xe0", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG signature dispatch marker role \\xe1", async () => {
  const image = await admit(rasterJpeg(42, 24, [0, 1, 1], directory(false, 42, 24, 2, 42, 24)));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG signature dispatch marker role \\xc0", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG signature dispatch marker role \\xc7", async () => {
  const source = rasterJpeg(42, 24);
  source[21] = 199;
  const image = await admit(source);
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
});

it("JPEG signature dispatch marker role \\xda", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG segment scan owned metadata extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG scanner boundary 0 preserves fill and segment traversal", async () => {
  const bytes = rasterJpeg(42, 24, [1, 42, 24]);
  const filled = joinBytes(bytes.slice(0, 2), new Uint8Array(1).fill(255), bytes.slice(2));
  expect((await admit(filled)).blob).toEqual(filled);
  expect((await admit(filled)).px_width).toBe(42);
  await expect(admit(filled.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("JPEG scanner boundary 1 preserves fill and segment traversal", async () => {
  const bytes = rasterJpeg(42, 24, [1, 42, 24]);
  const filled = joinBytes(bytes.slice(0, 2), new Uint8Array(2).fill(255), bytes.slice(2));
  expect((await admit(filled)).blob).toEqual(filled);
  expect((await admit(filled)).px_width).toBe(42);
  await expect(admit(filled.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("JPEG scanner boundary 2 preserves fill and segment traversal", async () => {
  const bytes = rasterJpeg(42, 24, [1, 42, 24]);
  const filled = joinBytes(bytes.slice(0, 2), new Uint8Array(3).fill(255), bytes.slice(2));
  expect((await admit(filled)).blob).toEqual(filled);
  expect((await admit(filled)).px_width).toBe(42);
  await expect(admit(filled.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("JPEG scanner boundary 3 preserves fill and segment traversal", async () => {
  const bytes = rasterJpeg(42, 24, [1, 42, 24]);
  const filled = joinBytes(bytes.slice(0, 2), new Uint8Array(4).fill(255), bytes.slice(2));
  expect((await admit(filled)).blob).toEqual(filled);
  expect((await admit(filled)).px_width).toBe(42);
  await expect(admit(filled.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("JPEG scanner boundary 4 preserves fill and segment traversal", async () => {
  const bytes = rasterJpeg(42, 24, [1, 42, 24]);
  const filled = joinBytes(bytes.slice(0, 2), new Uint8Array(5).fill(255), bytes.slice(2));
  expect((await admit(filled)).blob).toEqual(filled);
  expect((await admit(filled)).px_width).toBe(42);
  await expect(admit(filled.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("JPEG scanner boundary 6 preserves fill and segment traversal", async () => {
  const bytes = rasterJpeg(42, 24, [1, 42, 24]);
  const filled = joinBytes(bytes.slice(0, 2), new Uint8Array(7).fill(255), bytes.slice(2));
  expect((await admit(filled)).blob).toEqual(filled);
  expect((await admit(filled)).px_width).toBe(42);
  await expect(admit(filled.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("JPEG scanner boundary 8 preserves fill and segment traversal", async () => {
  const bytes = rasterJpeg(42, 24, [1, 42, 24]);
  const filled = joinBytes(bytes.slice(0, 2), new Uint8Array(9).fill(255), bytes.slice(2));
  expect((await admit(filled)).blob).toEqual(filled);
  expect((await admit(filled)).px_width).toBe(42);
  await expect(admit(filled.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("JPEG segment reader owned metadata extraction", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("JPEG segment reader marker traversal", async () => {
  const image = await admit(rasterJpeg(42, 24, [1, 42, 24]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/jpeg", "jpg", 42, 24, 42, 24]);
});

it("PNG owned metadata admission", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG signature MIME", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG canonical suffix", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG header reader owned metadata admission", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG header reader dimension extraction", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG header reader physical density extraction", async () => {
  const image = await admit(rasterPng(42, 24, [1654, 945, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 42.0116, 24.003]);
});

it("PNG density fallback no_setting 0", async () => {
  const image = await admit(rasterPng(42, 24));
  expect([image.horz_dpi, image.vert_dpi]).toEqual([72, 72]);
});

it("PNG density fallback no_setting 1", async () => {
  const image = await admit(rasterPng(42, 24, [1000, 1000, 0]));
  expect([image.horz_dpi, image.vert_dpi]).toEqual([72, 72]);
});

it("PNG density fallback no_setting 2", async () => {
  const image = await admit(rasterPng(42, 24));
  expect([image.horz_dpi, image.vert_dpi]).toEqual([72, 72]);
  const base = rasterPng(42, 24);
  await expect(
    admit(
      joinBytes(
        base.slice(0, 33),
        pngChunk("pHYs", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 255)),
        base.slice(33)
      )
    )
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("PNG density fallback no_setting 3", async () => {
  const image = await admit(rasterPng(42, 24, [0, 0, 1]));
  expect([image.horz_dpi, image.vert_dpi]).toEqual([72, 72]);
});

it("PNG density fallback no_setting 4", async () => {
  const image = await admit(rasterPng(42, 24));
  expect([image.horz_dpi, image.vert_dpi]).toEqual([72, 72]);
  const base = rasterPng(42, 24);
  await expect(
    admit(joinBytes(base.slice(0, 33), pngChunk("pHYs", new Uint8Array(8)), base.slice(33)))
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("PNG chunk sequence owned metadata admission", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG chunk sequence dimension chunk selection", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG optional density present is observable", async () => {
  const image = await admit(rasterPng(42, 24, [1654, 945, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 42.0116, 24.003]);
});

it("PNG optional density absent is observable", async () => {
  const image = await admit(rasterPng(42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 72, 72]);
});

it("PNG without a dimension header rejects", async () => {
  const source = rasterPng();
  await expect(admit(joinBytes(source.slice(0, 8), source.slice(33)))).rejects.toMatchObject({
    code: "unsupported-edit"
  });
});

it("PNG chunk reader owned metadata admission", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG chunk reader ordered chunk traversal", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG chunk reader bounded ancillary intervals", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG chunk dispatch dimension chunk selection", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG chunk dispatch chunk role pHYs", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG chunk dispatch chunk role IEND", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG record bounded ancillary intervals", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG dimension record bounded ancillary intervals", async () => {
  const image = await admit(rasterPng(42, 24, [1417, 2480, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 1417 * 0.0254, 2480 * 0.0254]);
});

it("PNG density record bounded ancillary intervals", async () => {
  const image = await admit(rasterPng(42, 24, [42, 24, 1]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/png", "png", 42, 24, 42 * 0.0254, 24 * 0.0254]);
});

it("TIFF admission extracts independent dimensions and densities", async () => {
  const image = await admit(directory(false, 111, 222, 2, 333, 444));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 111, 222, 333, 444]);
});

it("TIFF signature MIME", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF canonical suffix", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF directory reader owned header extraction", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF big endian directory admission", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF little endian directory admission", async () => {
  const image = await admit(directory(true, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF directory reader dimension extraction", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF resolution variant setting 0", async () => {
  const image = await admit(directory(false, 42, 24, 1, 150, 240));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 72, 72]);
});

it("TIFF resolution variant setting 1", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF resolution variant setting 2", async () => {
  const image = await admit(directory(false, 42, 24, 3, 100, 200));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 254, 508]);
});

it("TIFF resolution variant setting 3", async () => {
  const image = await admit(directory(false, 42, 24, 2, null, null));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 72, 72]);
});

it("TIFF resolution variant setting 4", async () => {
  const image = await admit(directory(false, 42, 24, null, 96, 100));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 96, 100]);
});

it("TIFF directory fields owned header extraction", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF directory fields tag selection independent of ordering", async () => {
  const entries = [
    { tag: 256, type: 3, values: [42] },
    { tag: 257, type: 4, values: [24] }
  ];
  const first = await admit(rasterDirectory(false, entries)),
    second = await admit(rasterDirectory(false, [...entries].reverse()));
  expect([first.px_width, first.px_height]).toEqual([second.px_width, second.px_height]);
});

it("TIFF directory traversal directory traversal", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF inert directory type 1 remains bounded", async () => {
  const bytes = rasterDirectory(false, [
    { tag: 65000, type: 1, values: [42] },
    { tag: 256, type: 4, values: [42] },
    { tag: 257, type: 4, values: [24] }
  ]);
  const image = await admit(bytes);
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
  await expect(admit(bytes.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("TIFF inert directory type 2 remains bounded", async () => {
  const bytes = rasterDirectory(false, [
    { tag: 65000, type: 2, values: [77, 97, 112, 108, 101, 0] },
    { tag: 256, type: 4, values: [42] },
    { tag: 257, type: 4, values: [24] }
  ]);
  const image = await admit(bytes);
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
  await expect(admit(bytes.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("TIFF inert directory type 3 remains bounded", async () => {
  const bytes = rasterDirectory(false, [
    { tag: 65000, type: 3, values: [42] },
    { tag: 256, type: 4, values: [42] },
    { tag: 257, type: 4, values: [24] }
  ]);
  const image = await admit(bytes);
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
  await expect(admit(bytes.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("TIFF inert directory type 4 remains bounded", async () => {
  const bytes = rasterDirectory(false, [
    { tag: 65000, type: 4, values: [42] },
    { tag: 256, type: 4, values: [42] },
    { tag: 257, type: 4, values: [24] }
  ]);
  const image = await admit(bytes);
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
  await expect(admit(bytes.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("TIFF inert directory type 5 remains bounded", async () => {
  const bytes = rasterDirectory(false, [
    { tag: 65000, type: 5, values: [42] },
    { tag: 256, type: 4, values: [42] },
    { tag: 257, type: 4, values: [24] }
  ]);
  const image = await admit(bytes);
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
  await expect(admit(bytes.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("TIFF inert directory type 6 remains bounded", async () => {
  const bytes = rasterDirectory(false, [
    { tag: 65000, type: 6, values: [42] },
    { tag: 256, type: 4, values: [42] },
    { tag: 257, type: 4, values: [24] }
  ]);
  const image = await admit(bytes);
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
  await expect(admit(bytes.slice(0, -1))).rejects.toMatchObject({ code: "unsupported-edit" });
});

it("TIFF directory field owned header extraction", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF directory field metadata ownership", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  const bytes = image.blob;
  bytes.fill(0);
  expect(image.px_width).toBe(42);
  expect(Object.isFrozen(image)).toBe(true);
});

it("TIFF text field bounded original ASCII field", async () => {
  const entries = [
    { tag: 65000, type: 2, values: [77, 97, 112, 108, 101, 0] },
    { tag: 256, type: 3, values: [42] },
    { tag: 257, type: 4, values: [24] }
  ];
  const image = await admit(rasterDirectory(false, entries));
  expect([image.px_width, image.px_height]).toEqual([42, 24]);
});

it("TIFF short field SHORT dimension field", async () => {
  const image = await admit(directory(false, 42, 24, 2, 42, 24));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 42, 24]);
});

it("TIFF long field LONG dimension field", async () => {
  const image = await admit(
    rasterDirectory(false, [
      { tag: 256, type: 4, values: [42] },
      { tag: 257, type: 3, values: [24] }
    ])
  );
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 42, 24, 72, 72]);
});

it("TIFF rational field fractional rational fields", async () => {
  const image = await admit(rasterTiff(false, 2, [42, 84], [24, 48]));
  expect([
    image.content_type,
    image.ext,
    image.px_width,
    image.px_height,
    image.horz_dpi,
    image.vert_dpi
  ]).toEqual(["image/tiff", "tiff", 1, 1, 0.5, 0.5]);
});
