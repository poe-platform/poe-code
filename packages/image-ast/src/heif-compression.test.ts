import { expect, it } from "vitest";
import { deflateSync, inflateSync } from "node:zlib";
import { build } from "esbuild";
import { decodeHeifImage, encodeHeifImage, readHeifMetadata } from "./codecs/heif.js";
import {
  decodeHeifToStorage,
  encodeHeifFromStorage,
  readHeifMetadataFromSource
} from "./codecs/heif-storage.js";
import { decodeImage } from "./codecs/index.js";

const signal = new AbortController().signal;
function image(width = 1, height = 1) {
  return decodeImage(undefined, {
    create: { width, height, channels: 4, background: { r: 12, g: 34, b: 56, alpha: 1 } }
  });
}
function payload(bytes: Uint8Array) {
  const marker = new TextEncoder().encode("POEHEIF1");
  for (let i = 0; i < bytes.length; i++)
    if (marker.every((v, j) => bytes[i + j] === v)) return i + 8;
  throw new Error("missing payload");
}
function backing() {
  const chunks = new Map<number, Uint8Array>();
  let end = 0,
    maxRead = 0;
  return {
    get maxRead() {
      return maxRead;
    },
    allocate(length: number) {
      const p = end;
      end += length;
      return p;
    },
    async write(p: number, b: Uint8Array) {
      chunks.set(p, b.slice());
    },
    async read(p: number, n: number) {
      maxRead = Math.max(maxRead, n);
      expect(n).toBeLessThanOrEqual(4096);
      const out = new Uint8Array(n);
      for (const [start, b] of chunks) {
        const a = Math.max(p, start),
          z = Math.min(p + n, start + b.length);
        if (a < z) out.set(b.subarray(a - start, z - start), a - p);
      }
      return out;
    }
  };
}
async function collect(source: AsyncIterable<Uint8Array>) {
  const chunks = [];
  let size = 0;
  for await (const b of source) {
    expect(b.length).toBeLessThanOrEqual(4096);
    chunks.push(b);
    size += b.length;
  }
  const out = new Uint8Array(size);
  let p = 0;
  for (const b of chunks) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
it.each(["heic", "heif", "avif"] as const)("cross-decodes %s with independent zlib", (format) => {
  const input = image(3, 2),
    encoded = encodeHeifImage(input, { format }),
    start = payload(encoded);
  expect(new Uint8Array(inflateSync(encoded.subarray(start)))).toEqual(input.data);
  const old = deflateSync(input.data, { level: 6 });
  expect(encoded.subarray(start, start + old.length)).toEqual(new Uint8Array(old));
  const reference = new Uint8Array(start + old.length);
  reference.set(encoded.subarray(0, start));
  reference.set(old, start);
  expect(decodeHeifImage(reference).data).toEqual(input.data);
});
it("bundles the complete HEIF closure using shared compression", async () => {
  const result = await build({
    entryPoints: [new URL("./codecs/heif.ts", import.meta.url).pathname],
    bundle: true,
    platform: "browser",
    write: false,
    metafile: true,
    format: "esm"
  });
  expect(Object.values(result.metafile!.outputs).flatMap((o) => o.imports)).toEqual([]);
  expect(
    Object.entries(result.metafile!.inputs)
      .find(([path]) => path.endsWith("/codecs/heif.ts"))![1]
      .imports.some((item) => item.path.includes("compression/"))
  ).toBe(true);
});
it("streams pixels larger than its working window through caller storage", async () => {
  const input = image(257, 33);
  let random = 12345;
  for (let i = 0; i < input.data.length; i++) {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    input.data[i] = random & 255;
  }
  const memory = backing(),
    position = memory.allocate(input.data.length);
  await memory.write(position, input.data);
  const { data: ignored, ...meta } = input;
  const encoded = await collect(
    encodeHeifFromStorage({ ...meta, position }, memory, signal, { format: "avif" })
  );
  expect(encoded.length).toBeGreaterThan(4096 * 4);
  expect(new Uint8Array(inflateSync(encoded.subarray(payload(encoded))))).toEqual(input.data);
  const source = {
    size: encoded.length,
    async read(p: number, n: number) {
      expect(n).toBeLessThanOrEqual(4096);
      return encoded.slice(p, p + n);
    }
  };
  const decoded = await decodeHeifToStorage(source, memory, signal);
  const result = new Uint8Array(input.data.length);
  for (let p = 0; p < result.length; p += 4096)
    result.set(await memory.read(decoded.position + p, Math.min(4096, result.length - p)), p);
  expect(result).toEqual(input.data);
  expect(decoded.format).toBe("avif");
});

function source(bytes: Uint8Array) {
  return {
    size: bytes.length,
    async read(p: number, n: number) {
      expect(n).toBeLessThanOrEqual(4096);
      return bytes.slice(p, p + n);
    }
  };
}
it.each([undefined, 1, 3, 6, 8])("preserves metadata orientation %s", async (orientation) => {
  for (const channels of [1, 2, 3, 4] as const) {
    const input = {
      ...image(7, 5),
      channels,
      hasAlpha: channels === 2 || channels === 4,
      space: channels < 3 ? ("b-w" as const) : ("srgb" as const)
    };
    const bytes = encodeHeifImage(input, {
      density: 144,
      ...(orientation === undefined ? {} : { orientation })
    });
    expect(await readHeifMetadataFromSource(source(bytes), signal)).toEqual(
      readHeifMetadata(bytes)
    );
  }
});
it.each(["truncated", "corrupt", "empty"])("preserves %s payload fallback", async (kind) => {
  const original = encodeHeifImage(image(3, 2)),
    start = payload(original),
    bytes = original.slice(
      0,
      kind === "empty" ? start : kind === "truncated" ? start + 4 : original.length
    );
  if (kind === "corrupt") bytes[start] = 0;
  const expected = decodeHeifImage(bytes),
    memory = backing(),
    decoded = await decodeHeifToStorage(source(bytes), memory, signal);
  expect(await memory.read(decoded.position, 24)).toEqual(expected.data);
});
it("honors encoder backpressure, early return and cancellation", async () => {
  const input = image(33, 41),
    memory = backing(),
    position = memory.allocate(input.data.length);
  await memory.write(position, input.data);
  const { data: ignored, ...meta } = input;
  let reads = 0;
  const storage = {
    ...memory,
    async read(p: number, n: number) {
      reads++;
      return memory.read(p, n);
    }
  };
  const controller = new AbortController(),
    output = encodeHeifFromStorage({ ...meta, position }, storage, controller.signal);
  expect(reads).toBe(0);
  await output.next();
  const afterHeader = reads;
  await Promise.resolve();
  expect(reads).toBe(afterHeader);
  await output.return(undefined);
  expect(reads).toBe(afterHeader);
  const reason = new Error("cancel HEIF");
  controller.abort(reason);
  await expect(
    encodeHeifFromStorage({ ...meta, position }, storage, controller.signal).next()
  ).rejects.toBe(reason);
});
it("propagates backing failures without turning them into fallback pixels", async () => {
  const bytes = encodeHeifImage(image(5, 3)),
    memory = backing(),
    reason = new Error("remote write failed");
  memory.write = async () => {
    throw reason;
  };
  await expect(decodeHeifToStorage(source(bytes), memory, signal)).rejects.toBe(reason);
});
it("skips malformed embedded previews before the opaque fallback", async () => {
  const input = encodeHeifImage(image(2, 2)),
    start = payload(input),
    bytes = input.slice(0, start + 20);
  bytes[start] = 0;
  bytes.set([255, 216, 255, 0, 0, 0, 0, 0], start + 3);
  const memory = backing(),
    decoded = await decodeHeifToStorage(source(bytes), memory, signal);
  expect(await memory.read(decoded.position, 16)).toEqual(decodeHeifImage(bytes).data);
});
it("preserves primary property association order", async () => {
  const bytes = encodeHeifImage(image(3, 2)),
    text = new TextDecoder("latin1").decode(bytes),
    pixi = text.indexOf("pixi"),
    ipma = text.indexOf("ipma");
  bytes[pixi + 8] = 3;
  bytes[ipma + 15] = 0x83;
  bytes[ipma + 16] = 0x82;
  bytes[ipma + 17] = 0x81;
  expect(await readHeifMetadataFromSource(source(bytes), signal)).toEqual(readHeifMetadata(bytes));
});

it("preserves the admitted empty pixel encoding and fallback", async () => {
  const input = { ...image(), width: 0, height: 0, data: new Uint8Array() },
    encoded = encodeHeifImage(input),
    start = payload(encoded);
  expect(new Uint8Array(inflateSync(encoded.subarray(start)))).toEqual(input.data);
  const memory = backing(),
    position = memory.allocate(0),
    { data: ignored, ...meta } = input;
  expect(await collect(encodeHeifFromStorage({ ...meta, position }, memory, signal))).toEqual(
    encoded
  );
  const decoded = await decodeHeifToStorage(source(encoded), memory, signal);
  expect(await memory.read(decoded.position, 4)).toEqual(decodeHeifImage(encoded).data);
});
