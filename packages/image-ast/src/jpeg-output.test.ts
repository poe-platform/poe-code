import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { defaultRuntime } from "@poe-code/compression";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import sharp from "./index.js";
import { encodeJpegImage as buffered, createJpegEncoder } from "./codecs/jpeg.js";
import { encodeJpegFromStorage } from "./codecs/jpeg-storage.js";
import type { RgbaImage, ImageMetadata } from "./ast.js";

export interface JpegOutputSpec {
  width: number;
  height: number;
  mode?: string;
  channels?: 1 | 2 | 3 | 4;
  density?: number;
  orientation?: number;
}
export interface JpegOutputOptions {
  quality?: number;
  density?: number;
  orientation?: number;
}
export function jpegOutputRaster(spec: JpegOutputSpec): RgbaImage {
  const data = new Uint8Array(spec.width * spec.height * 4);
  for (let p = 0; p < data.length / 4; p++) {
    const x = p % spec.width,
      y = Math.floor(p / spec.width),
      v =
        spec.mode === "flat"
          ? 128
          : spec.mode === "checker"
            ? ((x + y) % 2) * 255
            : (p * 43 + Math.floor(p / 7)) % 256;
    data.set(
      [
        v,
        spec.mode === "flat" ? v : (v * 7 + 13) % 256,
        spec.mode === "flat" ? v : (v * 11 + 17) % 256,
        spec.mode === "alpha" ? [0, 1, 127, 128, 254, 255][p % 6]! : 255
      ],
      p * 4
    );
  }
  const channels = spec.channels ?? 4;
  return {
    width: spec.width,
    height: spec.height,
    data,
    format: "raw",
    space: channels < 3 ? "b-w" : "srgb",
    channels,
    depth: "uchar",
    hasAlpha: channels === 2 || channels === 4,
    density: spec.density ?? 72,
    ...(spec.orientation === undefined ? {} : { orientation: spec.orientation })
  };
}
export interface JpegOutputVector {
  spec: JpegOutputSpec;
  options: JpegOutputOptions;
  hash: string;
  length: number;
  metadata: ImageMetadata;
}

// Frozen original JPEG encoder at e1398e5c28.
export const jpegOutputVectors: JpegOutputVector[] = [
  {
    spec: { width: 1, height: 1, mode: "flat" },
    options: {},
    hash: "6757f073a07f515b9045feefe65767de59e9ace5b4242505152dabf1b5330e46",
    length: 611,
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 611
    }
  },
  {
    spec: { width: 1, height: 1, mode: "checker" },
    options: {},
    hash: "ca38d9269aed4b2ce89f440f64ba4de8ad56031150f5c838efd4f30596d884fc",
    length: 614,
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 614
    }
  },
  {
    spec: { width: 1, height: 1, mode: "alpha" },
    options: {},
    hash: "41dc6b5492f0b2fb942037aae7d73194d499e67f8163d6839b981762fa04f2d9",
    length: 613,
    metadata: {
      format: "jpeg",
      width: 1,
      height: 1,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 613
    }
  },
  {
    spec: { width: 7, height: 7, mode: "flat" },
    options: {},
    hash: "8c4d24332cc4342f3c6e1ecc0daf1ea1db8401a707b973d8577042772366b125",
    length: 611,
    metadata: {
      format: "jpeg",
      width: 7,
      height: 7,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 611
    }
  },
  {
    spec: { width: 7, height: 7, mode: "checker" },
    options: {},
    hash: "bc0f396f45332ec89544b0fec8b62f481ddda44afc825265a91e49d7ff19ef36",
    length: 689,
    metadata: {
      format: "jpeg",
      width: 7,
      height: 7,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 689
    }
  },
  {
    spec: { width: 7, height: 7, mode: "alpha" },
    options: {},
    hash: "b8220f30010900819b61cf95d0a867aeae88a4f25d1c1c46208b9ad52a1c5158",
    length: 702,
    metadata: {
      format: "jpeg",
      width: 7,
      height: 7,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 702
    }
  },
  {
    spec: { width: 8, height: 8, mode: "flat" },
    options: {},
    hash: "be0dd3c9c4b1fab1a8084f6b166c734fc1abf8d81c9ef0f62542b2dd60f5d7b7",
    length: 611,
    metadata: {
      format: "jpeg",
      width: 8,
      height: 8,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 611
    }
  },
  {
    spec: { width: 8, height: 8, mode: "checker" },
    options: {},
    hash: "5b02e106959cf5fc990602d4b39b91163b052e4475fd8056fc4641cb13c38bfd",
    length: 665,
    metadata: {
      format: "jpeg",
      width: 8,
      height: 8,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 665
    }
  },
  {
    spec: { width: 8, height: 8, mode: "alpha" },
    options: {},
    hash: "83b66cd604293b41455e2731b89aa5424024c5af3608bc4b18366d6b67ba5d21",
    length: 697,
    metadata: {
      format: "jpeg",
      width: 8,
      height: 8,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 697
    }
  },
  {
    spec: { width: 9, height: 7, mode: "flat" },
    options: {},
    hash: "6e510a722da1dcb731edb62bd55df5811a420d4599a553edff5780b9864b034b",
    length: 613,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 7,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 613
    }
  },
  {
    spec: { width: 9, height: 7, mode: "checker" },
    options: {},
    hash: "f7f5a4c628fed723f8113adb6a5bcf6cf5bf0c1a1943556e3f4dbd9718b65892",
    length: 714,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 7,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 714
    }
  },
  {
    spec: { width: 9, height: 7, mode: "alpha" },
    options: {},
    hash: "5587f18533a71e1b93c891c7bd8ad26a8493139983da0a00510354132d8e1bdd",
    length: 730,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 7,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 730
    }
  },
  {
    spec: { width: 7, height: 9, mode: "flat" },
    options: {},
    hash: "8bcff16f7fbaf84c99ec5d6b65baaa5642791649109c3002043a210e3346562c",
    length: 613,
    metadata: {
      format: "jpeg",
      width: 7,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 613
    }
  },
  {
    spec: { width: 7, height: 9, mode: "checker" },
    options: {},
    hash: "9b0fdcec68643263bd2cb87c8c9474b7f220d32a4e398f69faa46344ebb35cb7",
    length: 713,
    metadata: {
      format: "jpeg",
      width: 7,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 713
    }
  },
  {
    spec: { width: 7, height: 9, mode: "alpha" },
    options: {},
    hash: "c3d3f7035bdd7cfdb747fb6b2fefa01a63c83685058ba0e1956ea78692a3396a",
    length: 727,
    metadata: {
      format: "jpeg",
      width: 7,
      height: 9,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 727
    }
  },
  {
    spec: { width: 15, height: 17, mode: "flat" },
    options: {},
    hash: "670cac82bca0e4dc500f3bdd04731707961c5d4a8382bae825114600d4519805",
    length: 620,
    metadata: {
      format: "jpeg",
      width: 15,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 620
    }
  },
  {
    spec: { width: 15, height: 17, mode: "checker" },
    options: {},
    hash: "33e1b88ec672c8626408a51d5d957c4d7685b47e7e31a9dd59df38cf5ac5289b",
    length: 907,
    metadata: {
      format: "jpeg",
      width: 15,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 907
    }
  },
  {
    spec: { width: 15, height: 17, mode: "alpha" },
    options: {},
    hash: "f8ca00b7762e75306d3be0eed100f819f9a389e22856edfc986937ec9c9dfde7",
    length: 1037,
    metadata: {
      format: "jpeg",
      width: 15,
      height: 17,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 1037
    }
  },
  {
    spec: { width: 16, height: 16, mode: "flat" },
    options: {},
    hash: "13adb33a016bc9ea686cd53f430765e532827087c3230b9f3bfa5ba0e2527557",
    length: 616,
    metadata: {
      format: "jpeg",
      width: 16,
      height: 16,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 616
    }
  },
  {
    spec: { width: 16, height: 16, mode: "checker" },
    options: {},
    hash: "199fb08a41d5126ac89268b407b468c6bda785b4acdf96c6a09bfed3a2dbd1a7",
    length: 820,
    metadata: {
      format: "jpeg",
      width: 16,
      height: 16,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 820
    }
  },
  {
    spec: { width: 16, height: 16, mode: "alpha" },
    options: {},
    hash: "f82d9446226de8eca1971a2d3d32636fa27cb63311f235a652278c40d736945c",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 16,
      height: 16,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 17, height: 15, mode: "flat" },
    options: {},
    hash: "ee52f4a5fdfd58c018275f3b161dde2a76bc36e7bbeff91d2df3c465bb4b5f0d",
    length: 620,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 15,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 620
    }
  },
  {
    spec: { width: 17, height: 15, mode: "checker" },
    options: {},
    hash: "9052c2317bb31f94f08ce3b627ad24bf10b90fb03cf67f5933a467148ab4acfe",
    length: 912,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 15,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 912
    }
  },
  {
    spec: { width: 17, height: 15, mode: "alpha" },
    options: {},
    hash: "89613c0a71fa8aaf92d9ccb363333b74eca7d887dea5110da68a14e2616671ff",
    length: 1052,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 15,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 1052
    }
  },
  {
    spec: { width: 67, height: 19, mode: "flat" },
    options: {},
    hash: "26e7456140c47d66e07079177bb1e24e71298d8576067dfec725f16950814675",
    length: 657,
    metadata: {
      format: "jpeg",
      width: 67,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 657
    }
  },
  {
    spec: { width: 67, height: 19, mode: "checker" },
    options: {},
    hash: "4ea58cb2974894c632b4dec9cae81148e579766aa510a0274fb155bda0002f61",
    length: 2224,
    metadata: {
      format: "jpeg",
      width: 67,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 2224
    }
  },
  {
    spec: { width: 67, height: 19, mode: "alpha" },
    options: {},
    hash: "0fbacdc13bc8914015094ca6fc0ba60e678a896e8551212568ddba69a61e5af7",
    length: 2875,
    metadata: {
      format: "jpeg",
      width: 67,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 2875
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: -10 },
    hash: "e49829d815c7919c8404693efa31cf06d138ccd785f4c929e901047d6a50e5e2",
    length: 668,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 668
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 0 },
    hash: "e49829d815c7919c8404693efa31cf06d138ccd785f4c929e901047d6a50e5e2",
    length: 668,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 668
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 1 },
    hash: "e49829d815c7919c8404693efa31cf06d138ccd785f4c929e901047d6a50e5e2",
    length: 668,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 668
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 25 },
    hash: "c74913bac3a27cd7b5a0fe5edea9caf5aef4b1a59bc6bac9ccf4370e9d53adae",
    length: 789,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 789
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 50 },
    hash: "ab745e149d3fbd08aa3b22bd8ee29a340d9734fc6709423986ebc54f3350d7e1",
    length: 930,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 930
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 75 },
    hash: "4f25d18d37221cb9602f109c61dd80fc67877f863bd660b998c0178cf35dfaa8",
    length: 1101,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 1101
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 85 },
    hash: "f3638b89d3cbde13dd372b707fa6983dcab1c91a6b916369872c006322ecc886",
    length: 1248,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 1248
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 99 },
    hash: "30621e16586bd58e7118e7eb52c041a1bcfdced76895ad4aea9212ae70ac341a",
    length: 2067,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 2067
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 100 },
    hash: "e1c283cd46158c40f0b491e5fb0397f08adf91fb73a9c40e5ea8a459a1b372d3",
    length: 2225,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 2225
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 150 },
    hash: "e1c283cd46158c40f0b491e5fb0397f08adf91fb73a9c40e5ea8a459a1b372d3",
    length: 2225,
    metadata: {
      format: "jpeg",
      width: 17,
      height: 19,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 2225
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 0 },
    hash: "790a21820fcb7aed64062968645f554de2191ab1666539704aca81c6a50ebd35",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 1 },
    hash: "dce70ffdfa4e70a57a78a994e6f08b8d720a701eaac434a34139be24384df3a4",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 1,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 6 },
    hash: "462f8d9a404d4fd3e10032d19d8934d7030fa74e0c3c6ad647371fa484c9bd2c",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 8 },
    hash: "54d609ffad03d39cf43cff45e78722b37fbe8c59fb96f35e59e6e023f618917b",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 8,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 9 },
    hash: "790a21820fcb7aed64062968645f554de2191ab1666539704aca81c6a50ebd35",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 0 },
    hash: "790a21820fcb7aed64062968645f554de2191ab1666539704aca81c6a50ebd35",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 1 },
    hash: "dce70ffdfa4e70a57a78a994e6f08b8d720a701eaac434a34139be24384df3a4",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 1,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 6 },
    hash: "462f8d9a404d4fd3e10032d19d8934d7030fa74e0c3c6ad647371fa484c9bd2c",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 8 },
    hash: "54d609ffad03d39cf43cff45e78722b37fbe8c59fb96f35e59e6e023f618917b",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 8,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 9 },
    hash: "790a21820fcb7aed64062968645f554de2191ab1666539704aca81c6a50ebd35",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 0 },
    hash: "790a21820fcb7aed64062968645f554de2191ab1666539704aca81c6a50ebd35",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 1 },
    hash: "dce70ffdfa4e70a57a78a994e6f08b8d720a701eaac434a34139be24384df3a4",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 1,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 6 },
    hash: "462f8d9a404d4fd3e10032d19d8934d7030fa74e0c3c6ad647371fa484c9bd2c",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 8 },
    hash: "54d609ffad03d39cf43cff45e78722b37fbe8c59fb96f35e59e6e023f618917b",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      orientation: 8,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 9 },
    hash: "790a21820fcb7aed64062968645f554de2191ab1666539704aca81c6a50ebd35",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 1,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 0 },
    hash: "3b9a5b2be2d575bfc6941be5b4fb0bd6751284933e5c3d5e1c040db2bb3839cc",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 73,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 1 },
    hash: "321d4577fbc5ee4c219390383a3204a1925ca4a054a813367e44524aea25d67d",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 73,
      hasAlpha: false,
      orientation: 1,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 6 },
    hash: "69d6cf5911743129bfea98b2b926bf47661d390c627967a2728874170ac944e8",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 73,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 8 },
    hash: "05e5b7f454dcc75de2e762c5a77439aa68a3a0a0785f46cc29f178c554565955",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 73,
      hasAlpha: false,
      orientation: 8,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 9 },
    hash: "3b9a5b2be2d575bfc6941be5b4fb0bd6751284933e5c3d5e1c040db2bb3839cc",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 73,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 0 },
    hash: "c35b73db6ec32142b1f108a82ffd640f7806d1036916837a5dd07dd40932dcc0",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 300,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 1 },
    hash: "8d65bc4ac78180c56d7186f68950cd7dda0145fb17a4ba81183456552b444073",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 300,
      hasAlpha: false,
      orientation: 1,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 6 },
    hash: "7083237c94e526dc7273781f3808b41ec7f485e4d149b810cbe7b736c8b6ae67",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 300,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 8 },
    hash: "60af4309f449b7ba35a4d79e25c1d7639d95d374ad413f15a590324a6d9a981d",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 300,
      hasAlpha: false,
      orientation: 8,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 9 },
    hash: "c35b73db6ec32142b1f108a82ffd640f7806d1036916837a5dd07dd40932dcc0",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 300,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 0 },
    hash: "03a68d9d9cb4dc93542fda894b01d29dc75f6673f5d1d53107ffbccaca71d48d",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 65535,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 1 },
    hash: "2fee2abe17ce8df9641dbde289bcaca3523dcf6a342ced98973011d94ba82ff5",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 65535,
      hasAlpha: false,
      orientation: 1,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 6 },
    hash: "da283f354b9df764fd3b5b2019ce4e4c2727b2f8b629ff5f329dc70d1f4fc93e",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 65535,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 8 },
    hash: "b9035f93b1ab8fe912d3b155255e0de48d85444fc328d7fc4ff5d6a1e1ea4693",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 65535,
      hasAlpha: false,
      orientation: 8,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 9 },
    hash: "03a68d9d9cb4dc93542fda894b01d29dc75f6673f5d1d53107ffbccaca71d48d",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 65535,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 0 },
    hash: "9b6bcebb3c334cbe6ec7b9cd9383e543cdc03515dd63ee051f2e78dd0ef362fb",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 1 },
    hash: "10e110e928ec87f0355160934bf00be3a47bee784cfe661446ec333c9f545af8",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 65536,
      hasAlpha: false,
      orientation: 1,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 6 },
    hash: "5f6aebd60fd443d07c6bc02551b4b59c77b37fd8059f2f181ea4913e4651aef2",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 65536,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 8 },
    hash: "0825e0cd39ad0bc19b9f03d3e85646cfdcb7ca281563b1f97de4f22b54eddba2",
    length: 964,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 65536,
      hasAlpha: false,
      orientation: 8,
      isProgressive: false,
      size: 964
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 9 },
    hash: "9b6bcebb3c334cbe6ec7b9cd9383e543cdc03515dd63ee051f2e78dd0ef362fb",
    length: 876,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      isProgressive: false,
      size: 876
    }
  },
  {
    spec: { width: 9, height: 11, channels: 1, density: 150, orientation: 6 },
    options: { quality: 1 },
    hash: "1b07078ec836aa99437e32a6228f8e9e82fd3e7d4040cb05bee7bfa703174246",
    length: 735,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 150,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 735
    }
  },
  {
    spec: { width: 9, height: 11, channels: 2, density: 150, orientation: 6 },
    options: { quality: 1 },
    hash: "1b07078ec836aa99437e32a6228f8e9e82fd3e7d4040cb05bee7bfa703174246",
    length: 735,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 150,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 735
    }
  },
  {
    spec: { width: 9, height: 11, channels: 3, density: 150, orientation: 6 },
    options: { quality: 1 },
    hash: "1b07078ec836aa99437e32a6228f8e9e82fd3e7d4040cb05bee7bfa703174246",
    length: 735,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 150,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 735
    }
  },
  {
    spec: { width: 9, height: 11, channels: 4, density: 150, orientation: 6 },
    options: { quality: 1 },
    hash: "1b07078ec836aa99437e32a6228f8e9e82fd3e7d4040cb05bee7bfa703174246",
    length: 735,
    metadata: {
      format: "jpeg",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 3,
      depth: "uchar",
      density: 150,
      hasAlpha: false,
      orientation: 6,
      isProgressive: false,
      size: 735
    }
  }
];

function backing(spec: JpegOutputSpec = jpegOutputVectors[0]!.spec) {
  const image = jpegOutputRaster(spec),
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
it.each(jpegOutputVectors)(
  "preserves frozen JPEG output $spec $options in both candidates",
  async (vector) => {
    const { image, stored, storage } = backing(vector.spec),
      before = new Uint8Array(image.data),
      hash = createHash("sha256");
    let length = 0;
    for await (const bytes of encodeJpegFromStorage(
      stored,
      storage,
      new AbortController().signal,
      vector.options
    )) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      hash.update(bytes);
      length += bytes.length;
    }
    expect(length).toBe(vector.length);
    expect(hash.digest("hex")).toBe(vector.hash);
    expect(digest(buffered(image, vector.options))).toBe(vector.hash);
    expect(image.data).toEqual(before);
    expect(storage.allocate).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
  }
);
it("bounds wide-raster cache and entropy chunks with borrowed backing pages", async () => {
  const { image, stored, storage } = backing({ width: 1031, height: 37, mode: "alpha" }),
    expected = digest(buffered(image, { quality: 100 })),
    Original = Uint8Array;
  vi.stubGlobal(
    "Uint8Array",
    new Proxy(Original, {
      construct(target, args) {
        const length = typeof args[0] === "number" ? args[0] : (args[0]?.length ?? 0);
        if (length > 4096) throw new Error("unbounded JPEG allocation");
        return Reflect.construct(target, args);
      }
    })
  );
  try {
    const hash = createHash("sha256");
    for await (const bytes of encodeJpegFromStorage(stored, storage, new AbortController().signal, {
      quality: 100
    })) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      hash.update(bytes);
    }
    expect(hash.digest("hex")).toBe(expected);
    expect(storage.read.mock.calls.length).toBeGreaterThan(32);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("owns yielded header and entropy chunks and honours pull/early-return", async () => {
  const { stored, storage } = backing({ width: 1031, height: 37 }),
    stream = encodeJpegFromStorage(stored, storage, new AbortController().signal),
    first = await stream.next();
  if (!(first.value instanceof Uint8Array)) throw new Error("missing header");
  const header = new Uint8Array(first.value);
  expect(storage.read).not.toHaveBeenCalled();
  const chunk = await stream.next();
  if (!(chunk.value instanceof Uint8Array)) throw new Error("missing entropy");
  const copy = new Uint8Array(chunk.value);
  for (let i = 0; i < 10; i++) await stream.next();
  expect(first.value).toEqual(header);
  expect(chunk.value).toEqual(copy);
  const reads = storage.read.mock.calls.length;
  await Promise.resolve();
  expect(storage.read).toHaveBeenCalledTimes(reads);
  await stream.return(undefined);
  await stream.next();
  expect(storage.read).toHaveBeenCalledTimes(reads);
});
it.each(["start", "header", "read", "chunk", "finish", "checkpoint"])(
  "preserves JPEG %s cancellation",
  async (phase) => {
    const { stored, storage } = backing({
        width: phase === "checkpoint" ? 1031 : 9,
        height: phase === "checkpoint" ? 37 : 9
      }),
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
    const checkpoint =
      phase === "checkpoint"
        ? vi.spyOn(defaultRuntime, "yieldTurn").mockImplementationOnce(async () => {
            controller.abort(reason);
          })
        : undefined;
    const stream = encodeJpegFromStorage(stored, storage, controller.signal);
    try {
      if (phase !== "start") {
        await stream.next();
        if (phase === "chunk") await stream.next();
        if (phase === "finish") for (let i = 0; i < 4; i++) await stream.next();
        if (phase !== "read" && phase !== "checkpoint") controller.abort(reason);
      }
      const consume = async () => {
        for await (const bytes of stream) expect(bytes.length).toBeLessThanOrEqual(4096);
      };
      await expect(consume()).rejects.toBe(reason);
    } finally {
      checkpoint?.mockRestore();
    }
  }
);
it.each(["short", "throw"])("propagates JPEG %s backing failure", async (kind) => {
  const { stored, storage } = backing(),
    reason = new Error("backing failure");
  if (kind === "short") storage.read.mockResolvedValueOnce(new Uint8Array(1));
  else storage.read.mockRejectedValueOnce(reason);
  const stream = encodeJpegFromStorage(stored, storage, new AbortController().signal);
  await stream.next();
  if (kind === "short")
    await expect(stream.next()).rejects.toThrow("Truncated image backing storage");
  else await expect(stream.next()).rejects.toBe(reason);
});
it.each([
  { width: 0 },
  { height: 1.5 },
  { width: 65536 },
  { height: 65536 },
  { position: -1 },
  { position: Number.MAX_SAFE_INTEGER }
])("rejects unrepresentable JPEG dimensions or storage %j", async (invalid) => {
  const { stored, storage } = backing(),
    stream = encodeJpegFromStorage(
      { ...stored, ...invalid },
      storage,
      new AbortController().signal
    );
  await expect(stream.next()).rejects.toThrow();
  expect(storage.read).not.toHaveBeenCalled();
});
it("admits maximal 16-bit JPEG dimensions without reading pixels for the header", async () => {
  const { stored, storage } = backing(),
    stream = encodeJpegFromStorage(
      { ...stored, width: 65535, height: 65535 },
      storage,
      new AbortController().signal
    ),
    header = await stream.next();
  expect(header.done).toBe(false);
  expect(storage.read).not.toHaveBeenCalled();
  await stream.return(undefined);
});
it("rejects partial encoder blocks before mutating entropy state", () => {
  const image = jpegOutputRaster({ width: 8, height: 8 }),
    encoder = createJpegEncoder(image),
    reference = createJpegEncoder(image);
  expect(() => encoder.block(new Uint8Array(255))).toThrow("64 RGBA pixels");
  expect(encoder.block(image.data)).toEqual(reference.block(image.data));
  expect(encoder.finish()).toEqual(reference.finish());
});
it("keeps independent interleaved encoders isolated", async () => {
  const a = backing({ width: 17, height: 19, mode: "alpha" }),
    b = backing({ width: 19, height: 17, mode: "checker" }),
    streams = [
      encodeJpegFromStorage(a.stored, a.storage, new AbortController().signal, { quality: 1 }),
      encodeJpegFromStorage(b.stored, b.storage, new AbortController().signal, { quality: 100 })
    ],
    hashes = [createHash("sha256"), createHash("sha256")];
  const active = [true, true];
  while (active.some(Boolean)) {
    for (let i = 0; i < 2; i++) {
      if (!active[i]) continue;
      const next = await streams[i]!.next();
      if (next.value instanceof Uint8Array) hashes[i]!.update(next.value);
      else active[i] = false;
    }
  }
  expect(hashes[0]!.digest("hex")).toBe(digest(buffered(a.image, { quality: 1 })));
  expect(hashes[1]!.digest("hex")).toBe(digest(buffered(b.image, { quality: 100 })));
});

it.each(["png", "ppm", "pgm", "pbm", "bmp", "tiff", "gif"] as const)(
  "streams JPEG output from %s through caller storage",
  async (format) => {
    const fs = new MemoryFileSystem(),
      pixels = Uint8Array.from({ length: 37 * 29 * 4 }, (_, i) => (i * 43) % 256),
      bytes = sharp(pixels, { raw: { width: 37, height: 29, channels: 4 } })
        .toFormat(format)
        .toBufferSync();
    await fs.writeFile("/in", bytes);
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const pipeline = (image: ReturnType<typeof sharp>) =>
      image.resize(19, 13).flip().rotate(17).jpeg({ quality: 83 });
    const expected = pipeline(sharp(bytes)).toBufferWithObjectSync(),
      info = await pipeline(sharp("/in", { filesystem: guarded })).toFile("/out");
    const actual = await fs.readFile("/out");
    expect(info).toEqual({ ...expected.info, size: actual.length });
    expect(Buffer.compare(actual, expected.data)).toBe(0);
    expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["in", "out"]);
  }
);
