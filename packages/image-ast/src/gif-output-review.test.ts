import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { RgbaImage } from "./ast.js";
import { decodeGifImage, encodeGifImage } from "./codecs/gif.js";
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
// Small palettes use frozen encoder hashes, with transparency flagged only for transparent frames.
// Former RGB332 fallback cases instead check decoded source-color accuracy.
const vectors: { spec: Spec; options: GifOptions; hash?: string }[] = [
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
    hash: "b0fb4724342115bc3c8d1725958e803f44a535b50b22ebb06910b0b76812dc5b"
  },
  {
    spec: { width: 2, height: 4, colors: 1, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "d14aa8fc36ab3490bcf2b00101824c9a5d12f718e5d35572d6f3a689ca801910"
  },
  {
    spec: { width: 2, height: 4, colors: 1, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "bb40a202ebee347708d6b9291b24bd81fe8c8e8ae96a7fef203c3e8d4c4f85da"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "1f8fd69653022a1072ef1ed7e70c17a26d3841c233e773bada4ebe4e578a560c"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "5f9d4c22f8b6d40998ab9fe89cbb0f86cfc5d3ec7ec73e1c8573de4feab93152"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "51c7e578cd32cdeca7dffc9bfbc004e9a7855de0017bd7eee9e9c95193806924"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "b60753548cb1f23b6e646652e1cbe2d928e402994746b3763e6e2ab5a0e8ca45"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "dadf0a317ef2f2c2b732c87fb025fe2bbb0698980b2de85084ccc875f652cc93"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "600d8e68c117fa39c3bb882c0bd8064faae3390d6e841564ac13714b435f4834"
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "196870a3da729ffa43bae302aa0b8955cdcff02a1dbaacac8ba9c12b0c5babd5"
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "5e47bd7db989a0d8ab2eb5c96db4659be88ff1f2576523a33ba865fe184cc06f"
  },
  {
    spec: { width: 256, height: 4, colors: 255, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 256, height: 4, colors: 255, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "2a4f2b9cd50af8bfef03a12c5319a6d82e1242419b6b81716ea7424110e8d330"
  },
  {
    spec: { width: 256, height: 4, colors: 255, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 257, height: 4, colors: 256, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 257, height: 4, colors: 256, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 257, height: 4, colors: 256, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 301, height: 4, colors: 300, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 301, height: 4, colors: 300, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "a90625d97c235c5ae2257bda0d781788d4db63bf54286846f2c6f474fb6d8718"
  },
  {
    spec: { width: 301, height: 4, colors: 300, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
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
    hash: "91d47ba56ff844951be30860dbf93c9e6946ff963992169c436acac8ab3a5445"
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
    hash: "3516adbca0bbe478ff3a7ddc5ac644b3955217570e8ea5a877fd727b33d69414"
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
    hash: "7ab17936e7a1a82e4778e46441893d5dc5781e3281d97f07082ce061a435393a"
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
    hash: "a12fb3448b4d81dd627d013fe30416378bef739d3c39c3b0e27e4bb98fa7aafa"
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
    hash: "d4711124ce125ceb2c52a9a3467176df1014912ed473071d94918e456d8364b0"
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
    hash: "4bd973135affebab0c429d2ef6b1fff42ab296b176a1d7b8edf7bf729849447e"
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
    hash: "91d47ba56ff844951be30860dbf93c9e6946ff963992169c436acac8ab3a5445"
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
    hash: "3adfcbd8c1a20aa694022952084ce2e079434d7b6242d263d3352b8881ea5aed"
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
    hash: "97f84c5e157e29b6ceb03034aa2239d462055de55fbd70c8eaf9a30eca531050"
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
    hash: "3adfcbd8c1a20aa694022952084ce2e079434d7b6242d263d3352b8881ea5aed"
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
it.each(vectors)(
  "preserves GIF colors and storage parity for $spec and $options",
  async (vector) => {
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
    const encoded = encodeGifImage(image, vector.options);
    expect(hash.digest("hex")).toBe(digest(encoded));
    if (vector.hash) expect(digest(encoded)).toBe(vector.hash);
    else {
      const decoded = decodeGifImage(encoded, { animated: true });
      expect(decoded.data.length).toBe(image.data.length);
      let error = 0,
        channels = 0;
      for (let i = 0; i < image.data.length; i += 4) {
        const alpha = image.data[i + 3]! < 128 ? 0 : 255;
        expect(decoded.data[i + 3]).toBe(alpha);
        if (alpha)
          for (let c = 0; c < 3; c++) {
            error += Math.abs(decoded.data[i + c]! - image.data[i + c]!);
            channels++;
          }
      }
      expect(error / channels).toBeLessThan(4);
    }
    expect(image.data).toEqual(before);
    expect(storage.allocate).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
  }
);
it("bounds raster cache and output chunks while retaining owned bytes across yields", async () => {
  const { stored, storage } = backing({ width: 1031, height: 37, colors: 400, mode: "alpha" }),
    Original = Uint8Array;
  vi.stubGlobal(
    "Uint8Array",
    new Proxy(Original, {
      construct(target, args) {
        const length = typeof args[0] === "number" ? args[0] : (args[0]?.length ?? 0);
        // The palette lookup has a fixed 32K bound independent of raster size.
        if (length > 4096 && length !== 32768) throw new Error("unbounded GIF allocation");
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
