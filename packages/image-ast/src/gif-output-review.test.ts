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
// Single-color vectors include their source color as the screen background.
// Former RGB332 fallback cases instead check decoded source-color accuracy.
const vectors: { spec: Spec; options: GifOptions; hash?: string }[] = [
  {
    spec: { width: 1, height: 1, colors: 254 },
    options: {},
    hash: "164fd9758fffa20e74533c0b473f558b62a93be7873ffc96997cc96ec205a5b0"
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
    hash: "81c543ef2a5f3cde2658e7fd812f95d0fdfd077e68e1c19571cacdea57271209"
  },
  {
    spec: { width: 2, height: 4, colors: 1, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "bc13d46ce45ccd35edea2cd3d249fcf58ad7b7eca1c048fc9d35f97c3678815d"
  },
  {
    spec: { width: 2, height: 4, colors: 1, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "22bb543a9eba86219a9c15dad87e0a98f75147383e4677aef1233106cd3f54fb"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "806a05acfec36470f432da362a0b08f396da02fb7b2da3a7832341c3f5e59e2d"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "ccb5bb6b1993495fa0cb0231072b3bb0c2fc1e52590c9690ff2c74de093346da"
  },
  {
    spec: { width: 253, height: 4, colors: 252, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "909007c0219ee7560446c48305bbbc9756b57e6a2f2d556b696380d32ad879aa"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "29d969cda79aec3d8ef55d9c597186e1e0274146f0846ce2c90fb2e2de6acad4"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "adb269679e55e578cb84c993e7f30c31bd4165dfdbb3c0f784fdb1daa866c762"
  },
  {
    spec: { width: 254, height: 4, colors: 253, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "2cab43e0888eff5e74a616d44ee68bbd4553c9a8946d63f38714126bd02e24d5"
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "1fbedd8e4104e0da2117a06b3082117d5e257b0318748a3ec2f74b3d7bc773c8"
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 255, height: 4, colors: 254, mode: "alpha" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "053a693b4f88544f176f5ae43af3b7033ae92bb0d1879948232df26ad06242b0"
  },
  {
    spec: { width: 256, height: 4, colors: 255, mode: "grid" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 }
  },
  {
    spec: { width: 256, height: 4, colors: 255, mode: "white" },
    options: { pageHeight: 1, delay: [12, 35], loop: 2 },
    hash: "0c756722047fa36d36264d3d078ccd804886a004ae24cdf4832cbe8585f89658"
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
    hash: "835cd969966cbd1de10be18c3778b5de1fb1408cff36bba7e7136420b984016d"
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
    hash: "9ebe9026bbaf27656bf90670debb181f8a9ab60ba31721a5f3cedae0eaaf6ac1"
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
    hash: "40a0f3ddcfc7e8e88290254ad34b452b10108553e7db3ecf420d9074e3edf846"
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
    hash: "16d47a4c34290ea83ed8a80b6b4a32d9da5a01104e974c0b105874063bb25e43"
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
    hash: "6f06ead8d1a466fdf7157a0cf84a97d9785fc6b1659ba64164b11c4aff3c0cf5"
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
    hash: "16d47a4c34290ea83ed8a80b6b4a32d9da5a01104e974c0b105874063bb25e43"
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
    hash: "0d84a7fb4d6bb0106d861a03955fd87160b6f23cf5714f93e9f3b4992e5c0f4d"
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
    hash: "9ebe9026bbaf27656bf90670debb181f8a9ab60ba31721a5f3cedae0eaaf6ac1"
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
    hash: "a8f92dca892cb3a667890810d880dc5c7a4a3be8ccfe7cd8179002452e6d7e65"
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
    hash: "f17aedd88d0866ae5eed917cc0c3a821427e56936f50f25888188c337a79678f"
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
    hash: "f17aedd88d0866ae5eed917cc0c3a821427e56936f50f25888188c337a79678f"
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
    hash: "2dd86bd1c687b3457ff9ba128839c0b8abe018ba06a380e9d981b7ba5b357931"
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
    hash: "919324c063759c4b86b3718986994a80163fdc064c25c9c0eb77bca6746a5575"
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
    hash: "2dd86bd1c687b3457ff9ba128839c0b8abe018ba06a380e9d981b7ba5b357931"
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

it("truncates millisecond delays to GIF centiseconds in buffered and stored output", async () => {
  const { image, stored, storage } = backing({
    width: 2, height: 5, colors: 2, pageHeight: 1, delay: [5, 15, 19, 41, 291], loop: 0,
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodeGifFromStorage(stored, storage, new AbortController().signal)) {
    chunks.push(chunk.slice());
  }
  for (const bytes of [encodeGifImage(image), Buffer.concat(chunks)]) {
    expect(decodeGifImage(bytes, { animated: true }).delay).toEqual([0, 10, 10, 40, 290]);
  }
});
