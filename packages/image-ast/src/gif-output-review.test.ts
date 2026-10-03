import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { RgbaImage } from "./ast.js";
import { encodeGifImage } from "./codecs/gif.js";
import { encodeGifFromStorage } from "./codecs/gif-storage.js";
import type { GifOptions } from "./codecs/gif-output-parts.js";
interface Spec {
  width: number;
  height: number;
  colors: number;
  mode?: string;
  pageHeight?: number;
  delay?: number[];
  loop?: number;
}
function raster(spec: Spec): RgbaImage {
  const data = new Uint8Array(spec.width * spec.height * 4);
  for (let i = 0; i < data.length / 4; i++) {
    const n = i % spec.colors;
    let r = n & 255,
      g = (n >>> 8) & 255,
      b = 17;
    if (spec.mode === "grid") {
      r = Math.round((((n >>> 5) & 7) * 255) / 7);
      g = Math.round((((n >>> 2) & 7) * 255) / 7);
      b = Math.round(((n & 3) * 255) / 3);
    }
    if (spec.mode === "white" && i % 3 === 0) r = g = b = 255;
    data.set(
      [r, g, b, spec.mode === "alpha" ? [0, 127, 128, 255][Math.floor(i / spec.width) % 4]! : 255],
      i * 4
    );
  }
  return {
    ...spec,
    data,
    channels: 4,
    format: "raw",
    space: "srgb",
    depth: "uchar",
    density: 72,
    hasAlpha: true
  };
}
// Frozen independently executed old GIF encoder hashes at 7e531d71ec.
const vectors: { spec: Spec; options: GifOptions; hash: string }[] = [
  {
    spec: { width: 1, height: 1, colors: 254 },
    options: {},
    hash: "b46352beb02d635162606e38ccde029be5a8dbc9d8a8d9cb016489e1a27f367e"
  },
  {
    spec: { width: 119, height: 1, colors: 254 },
    options: {},
    hash: "28c7e78a59d2ea78fb31e2e93f7cefc51031b3132f1ba41b8341b596e96fd35a"
  },
  {
    spec: { width: 120, height: 1, colors: 254 },
    options: {},
    hash: "653d43660d70204bfb9501bd9af7759f13969745bd9893d5f71c12d7c73320db"
  },
  {
    spec: { width: 121, height: 1, colors: 254 },
    options: {},
    hash: "61884c4b3f1130b28ffd92c3c010418a301c35d78804cfb453ca0316b849be5f"
  },
  {
    spec: { width: 224, height: 1, colors: 254 },
    options: {},
    hash: "07b553d7fa7b2cc837c3643f760351986fe1ceb37e11ddb1ddc16e6404087493"
  },
  {
    spec: { width: 225, height: 1, colors: 254 },
    options: {},
    hash: "447058292efc04dc491630fc01d6f0dcded8cbae160db9127ffb998f1135c718"
  },
  {
    spec: { width: 226, height: 1, colors: 254 },
    options: {},
    hash: "e61f5ea96377f78f4a3f06bd1d3f14142de93a3474f218ed9af1814e8c7c44e9"
  },
  {
    spec: { width: 227, height: 1, colors: 254 },
    options: {},
    hash: "6413a2fb672a436eb31ae20b34a3fa5bb6802f31523870bec6c99584111be745"
  },
  {
    spec: { width: 239, height: 1, colors: 254 },
    options: {},
    hash: "a3ba57a11c8ab327481cf79d582feac4f4c8b968ffbdec2c5ff398fc00e885d8"
  },
  {
    spec: { width: 240, height: 1, colors: 254 },
    options: {},
    hash: "f5b800c925058f2916ba5d42771f979e9638270ec53b7523e767e5ad9402d5f1"
  },
  {
    spec: { width: 241, height: 1, colors: 254 },
    options: {},
    hash: "4d3b746ba55d0857efdb7deba799a70626c3ef236e4cc3b358c1f67e70715060"
  },
  {
    spec: { width: 451, height: 1, colors: 254 },
    options: {},
    hash: "5bc10bbfc86986e5d9753edb64e0ffd64dc6db4a5016bd42bd1fa5bcc223f314"
  },
  {
    spec: { width: 1025, height: 1, colors: 254 },
    options: {},
    hash: "309d7e90184d07e9c964c400ea90c31f016394c97622401ee0a3c16b6f3a8214"
  },
  {
    spec: { width: 2, height: 4, colors: 1, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "5963f360db29bb7bd7627f6352b2e2aab053f45606585e4f5d27e2df414b2efb"
  },
  {
    spec: { width: 2, height: 4, colors: 1, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "cf98bc38d5aac58621fe0e8c1aa21d6585f8031300475b5fffaebd1d3e4d816a"
  },
  {
    spec: { width: 2, height: 4, colors: 1, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "4228a4c979525e61329b6c423aacb42aa8bd1ec8f89912aae6248f7a24e73a90"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "37901c5c19a1ce2381a202211156a9b1c148a4d6eb67e3655efdb142fbd35383"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "5c50cad9852308695963db45efb9c9f6d8dc777a55ed1d64054e9cd4b732bc17"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "7a2d08bc39565af3bbafc0eab8034ece7e0f20a6f543e374dbaa09e6c899fa5c"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "5cd974eb3429ccf04bc1eea9e789828b03d32e010fd90b1401c978174548066d"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "44a8680383ac7ae1b8275b69c394a9951c9577da47093f343885685dc732dfec"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "7517713b7670412d5bc3f24b1aed5cfe45a9575e12ac84d052a0f4c97b23feed"
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "7208e70f73128d14de006159f2684a291cc2382c09b9674caeadb777a88dd21b"
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "b125aa1dbd5be52fbfea7bbdab68c5ef5a2bef8b84c3ef1fc9a0fb589652a0be"
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "2ff6cae12e33fecf0d181a5f45a11821bd0d9d48b31575d6a5b2870f119d531e"
  },
  {
    spec: { width: 256, height: 4, colors: 255, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "a08085b0c51de1f41ec65b4a223813f57cffb5aad4bd30c29cc9a905934b2867"
  },
  {
    spec: { width: 256, height: 4, colors: 255, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "86af52b75209e0293d08249dfeb600ae477cc1d1445a4a2023c1338ccc5c0cb2"
  },
  {
    spec: { width: 256, height: 4, colors: 255, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "ea862e3d6aa7f8527eea097dcc8cdb2d426e54336705891743b31a3de7c0f25c"
  },
  {
    spec: { width: 257, height: 4, colors: 256, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "d07c170c64c143d764eb30e3c4bffaa0a5f2ef98a125c2374316bafe6c312a87"
  },
  {
    spec: { width: 257, height: 4, colors: 256, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "86f41017438da3fe3665e5ff50ab7e6ae32d93a8e528519f9fd5ccc710b35c59"
  },
  {
    spec: { width: 257, height: 4, colors: 256, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "cc8a30feab2ef3299d57a94cf3c8d8e3ff101e5c98c87d8222a62f4b85342d5f"
  },
  {
    spec: { width: 301, height: 4, colors: 300, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "097c178c0642e6bdd1f8af32bacbe8e39377d035690a1ead7a790d8899d86f68"
  },
  {
    spec: { width: 301, height: 4, colors: 300, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "1386d8a0d8c946abc276fadedc9109a4dfeaa722404274ed3dbda7493b9800c5"
  },
  {
    spec: { width: 301, height: 4, colors: 300, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "e60e2615d2ea6ac850cc61f787cd5373f213721582fe6c15c5ad94cba8f50850"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: {},
    hash: "6fd542a8d93f6a04f7bbfdc6e3377c6ef35015bf0feb143f1d84fa5558d49c64"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { delay: 0 },
    hash: "334a51511fa345e94bbb764985a2a67acc9c22e89ce81beab57f0438416f512d"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { delay: 15 },
    hash: "b0947728969e571e58ca0fc4296126f072ab2fb21baa5984622f3522395a004a"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { delay: [] },
    hash: "9a16e56285cebc31f05cd09df740a420e8ddb79376bdb41873b77fcdeb22f872"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { delay: [10] },
    hash: "2ee6cae61212fbac6b2b93d392be03558966736f8d4fb7f7610ed28f9f6774eb"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { delay: [10, 20] },
    hash: "06e1934b03931ef00696c48ca509aca683be56acdcadb3e00d562a6b71896b02"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { pageHeight: 2 },
    hash: "6fd542a8d93f6a04f7bbfdc6e3377c6ef35015bf0feb143f1d84fa5558d49c64"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { pageHeight: 3 },
    hash: "5f5e6d41e0582dbc7bbcbc563c114f2432e8b110a0444cd369c121be4a28009c"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { pageHeight: 7 },
    hash: "6ef40ed421b6de952cc59200ff85447901dc038e38c0989b173396d60806912b"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { pageHeight: 0 },
    hash: "6ef40ed421b6de952cc59200ff85447901dc038e38c0989b173396d60806912b"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { loop: 0 },
    hash: "4264c95fee576bd0895bde94c5f10f75f628a03a78e88bc7314acf7d52f21254"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { loop: 1 },
    hash: "4264c95fee576bd0895bde94c5f10f75f628a03a78e88bc7314acf7d52f21254"
  },
  {
    spec: {
      width: 17,
      height: 6,
      colors: 99,
      mode: "alpha",
      pageHeight: 2,
      delay: [5, 99],
      loop: 3
    },
    options: { loop: 65537 },
    hash: "4264c95fee576bd0895bde94c5f10f75f628a03a78e88bc7314acf7d52f21254"
  }
];
function backing(spec: Spec = vectors[0]!.spec) {
  const image = raster(spec),
    borrowed = new Uint8Array(4096),
    storage = {
      allocate: vi.fn(() => {
        throw new Error("unexpected allocation");
      }),
      write: vi.fn(async () => {
        throw new Error("unexpected write");
      }),
      read: vi.fn(async (position: number, length: number) => {
        if (position < 8 || length > 4096 || position + length > image.data.length + 8)
          throw new Error("invalid backing read");
        borrowed.fill(37);
        borrowed.set(image.data.subarray(position - 8, position - 8 + length));
        return borrowed.subarray(0, length);
      })
    };
  return { image, stored: { ...image, position: 8 }, storage };
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
it.each(vectors)("matches frozen GIF bytes for $spec and $options", async (vector) => {
  const { image, stored, storage } = backing(vector.spec),
    hash = createHash("sha256"),
    before = new Uint8Array(image.data);
  for await (const bytes of encodeGifFromStorage(
    stored,
    storage,
    new AbortController().signal,
    vector.options
  ))
    hash.update(bytes);
  expect(hash.digest("hex")).toBe(vector.hash);
  expect(digest(encodeGifImage(image, vector.options))).toBe(vector.hash);
  expect(image.data).toEqual(before);
  expect(storage.allocate).not.toHaveBeenCalled();
  expect(storage.write).not.toHaveBeenCalled();
});
it("bounds raster cache and output chunks while retaining owned bytes across yields", async () => {
  const { stored, storage } = backing({ width: 1031, height: 37, colors: 400, mode: "alpha" }),
    Original = Uint8Array;
  vi.stubGlobal(
    "Uint8Array",
    new Proxy(Original, {
      construct(target, args) {
        const length = typeof args[0] === "number" ? args[0] : (args[0]?.length ?? 0);
        if (length > 4096) throw new Error("unbounded GIF allocation");
        return Reflect.construct(target, args);
      }
    })
  );
  try {
    const stream = encodeGifFromStorage(stored, storage, new AbortController().signal),
      first = await stream.next();
    if (!(first.value instanceof Uint8Array)) throw new Error("missing GIF header");
    const header = new Uint8Array(first.value);
    await stream.next();
    const chunk = await stream.next();
    if (!(chunk.value instanceof Uint8Array)) throw new Error("missing GIF codes");
    const copy = new Uint8Array(chunk.value);
    for (let i = 0; i < 5; i++) await stream.next();
    expect(first.value).toEqual(header);
    expect(chunk.value).toEqual(copy);
    const reads = storage.read.mock.calls.length;
    await Promise.resolve();
    expect(storage.read).toHaveBeenCalledTimes(reads);
    await stream.return(undefined);
    await stream.next();
    expect(storage.read).toHaveBeenCalledTimes(reads);
    expect(reads).toBeGreaterThan(32);
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each(["start", "read", "header", "frame", "codes", "trailer"])(
  "preserves GIF %s cancellation",
  async (phase) => {
    const { stored, storage } = backing({ width: 451, height: 1, colors: 253 }),
      controller = new AbortController(),
      reason = { phase };
    if (phase === "start") controller.abort(reason);
    if (phase === "read") {
      const read = storage.read.getMockImplementation()!;
      storage.read.mockImplementationOnce(async (position, length) => {
        const bytes = await read(position, length);
        controller.abort(reason);
        return bytes;
      });
    }
    const stream = encodeGifFromStorage(stored, storage, controller.signal);
    if (phase !== "start" && phase !== "read") {
      await stream.next();
      if (phase !== "header") await stream.next();
      if (phase === "codes") await stream.next();
      if (phase === "trailer") {
        let chunk = await stream.next();
        while (chunk.value && chunk.value.length !== 1) chunk = await stream.next();
      }
      controller.abort(reason);
    }
    const reads = storage.read.mock.calls.length;
    await expect(stream.next()).rejects.toBe(reason);
    expect(storage.read).toHaveBeenCalledTimes(phase === "read" ? 1 : reads);
  }
);
it.each(["short", "throw"])("propagates GIF %s storage failure", async (kind) => {
  const { stored, storage } = backing(),
    reason = new Error("storage failed");
  if (kind === "short") storage.read.mockResolvedValueOnce(new Uint8Array(1));
  else storage.read.mockRejectedValueOnce(reason);
  const stream = encodeGifFromStorage(stored, storage, new AbortController().signal);
  if (kind === "short")
    await expect(stream.next()).rejects.toThrow("Truncated image backing storage");
  else await expect(stream.next()).rejects.toBe(reason);
});
it.each([
  { width: 0 },
  { width: 65536 },
  { height: 65536 },
  { height: 1.5 },
  { position: -1 },
  { position: Number.MAX_SAFE_INTEGER }
])("rejects invalid GIF backing/frame dimensions %j", async (invalid) => {
  const { stored, storage } = backing(),
    stream = encodeGifFromStorage({ ...stored, ...invalid }, storage, new AbortController().signal);
  await expect(stream.next()).rejects.toThrow();
  expect(storage.read).not.toHaveBeenCalled();
});
it("admits tall animation stacks when each encoded frame fits 16 bits", async () => {
  const { stored, storage } = backing({ width: 1, height: 65536, colors: 2 }),
    stream = encodeGifFromStorage(stored, storage, new AbortController().signal, {
      pageHeight: 32768
    });
  const first = await stream.next();
  expect(first.done).toBe(false);
  expect(first.value![8]! | (first.value![9]! << 8)).toBe(32768);
  await stream.return(undefined);
});
it("rejects fractional frame heights before reading backing", async () => {
  const { stored, storage } = backing({ width: 1, height: 6, colors: 2 }),
    stream = encodeGifFromStorage(stored, storage, new AbortController().signal, {
      pageHeight: 1.5
    });
  await expect(stream.next()).rejects.toThrow();
  expect(storage.read).not.toHaveBeenCalled();
});
