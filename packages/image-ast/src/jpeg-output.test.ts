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

// Frozen JPEG output with native fast integer DCT and 8-bit YCbCr rounding.
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
    hash: "c8b6752e30439f1bbf69d56ab28078f276e4dbdc63be59658176b68e90da3a51",
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
    hash: "ef7995ff5be515fabb1523271334a516a258cc5b0aa2bc5140afb2b226434fd3",
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
    hash: "4bf956017f450f2a3f9ae30b624938c56c87770cb355a254295b8af96739c898",
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
    hash: "f004a727011c861212fa5cdd4de3d36b77551da19e5bdb81939101d90b4c3017",
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
    hash: "1049c1f53e665370db55429a3ef43f90a5527ce46ed42db20d510db6ffd931f9",
    length: 698,
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
      size: 698
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
    hash: "bcb000b28382f4869ada2ca737a44516b52c4454cf0d26ea83dfd5512c690851",
    length: 711,
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
      size: 711
    }
  },
  {
    spec: { width: 9, height: 7, mode: "alpha" },
    options: {},
    hash: "81a64664045fab946a7c802a89bf50103d1b26a33b222db9a35fe5a17f193f50",
    length: 732,
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
      size: 732
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
    hash: "ed75bffb73747a51f1f8c6312afd8cb5ee32ef8e1ee4e7e01931eba72b7217b6",
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
    hash: "3fdb20523ddeee54e89dc0cbb271d7b4caac48cb0bd2c517e03041426a62e63c",
    length: 732,
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
      size: 732
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
    hash: "108389d1c15fba586b96d5d2b05f0599bcc5a3d6370a94d65103cde2bb44b0e5",
    length: 906,
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
      size: 906
    }
  },
  {
    spec: { width: 15, height: 17, mode: "alpha" },
    options: {},
    hash: "3a2d9b6cb4a7e4b1eb6dc9d0ee96e841a33a9059414acb088166071e3545d2de",
    length: 1036,
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
      size: 1036
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
    hash: "b9b142dd11bd4503efd7c5d12ef775324f8fd0ac3b86828c927b306897fb010a",
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
    hash: "b8c5e79b1e706a8b63f9063e6f5eec1c12b174ea5aa1ee7aa24fa173dc0e799a",
    length: 966,
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
      size: 966
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
    hash: "9f7d2b77827efee73c8e353bc79b717164ae4d5bb54f13579fd302be8993bc05",
    length: 909,
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
      size: 909
    }
  },
  {
    spec: { width: 17, height: 15, mode: "alpha" },
    options: {},
    hash: "f80feea640305e15e66c676a30be643568ad366dfcf02d860371d8a7927f51a4",
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
    hash: "aebff6234326b6c64694bc77fc12d85af284b1423efb777091ad6f47df979ca9",
    length: 2223,
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
      size: 2223
    }
  },
  {
    spec: { width: 67, height: 19, mode: "alpha" },
    options: {},
    hash: "78d92f974ccbfafd59125548479f04d962a36211dd542146ae030729d2388919",
    length: 2890,
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
      size: 2890
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
    hash: "e6f8104e90be13cb6f3dec2bec6325ac812bc53bd172a106e170adacaef3fb13",
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
    hash: "a15f5915930bef22c6ae837a9831528df9d0fcf9d36c6885ad817f206fc071a5",
    length: 922,
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
      size: 922
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 75 },
    hash: "5f5de0a38e4aa79bef36c00b84bb56cf76cfed7c945a6d3423f35fc1fb7f1c57",
    length: 1097,
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
      size: 1097
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 85 },
    hash: "c120f50ce337577094e28d3d24a6fe7b5746617f636539d3b4ac84bbe319efbf",
    length: 1251,
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
      size: 1251
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 99 },
    hash: "79c48f4eee630417b000e468dce6fec7734b73b9e81f42ebf28d577886fa179d",
    length: 2076,
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
      size: 2076
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 100 },
    hash: "27e4f176d0bc338ed2643cec4e7583c5f20542be7bca1efa8d1eb6c38a85fb2a",
    length: 2226,
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
      size: 2226
    }
  },
  {
    spec: { width: 17, height: 19, mode: "alpha" },
    options: { quality: 150 },
    hash: "27e4f176d0bc338ed2643cec4e7583c5f20542be7bca1efa8d1eb6c38a85fb2a",
    length: 2226,
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
      size: 2226
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 0 },
    hash: "25993b8f38e0ab0fd443e86a586e16fc802830050253ba28fdab1c2e2b130a6d",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 1 },
    hash: "1239afcc48f5bca6708d32d5fd71ffaae5c529d23ef5cb0c1cd72619502c2118",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 6 },
    hash: "54d8e49d0357632d02d91ade43ff8d6dd6082cac8161f82187e30df37c701951",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 8 },
    hash: "6906bbe39bcd37075b208ebd0b88168a36b0bbbde9b57bf4a610b35234154170",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: -1, orientation: 9 },
    hash: "25993b8f38e0ab0fd443e86a586e16fc802830050253ba28fdab1c2e2b130a6d",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 0 },
    hash: "25993b8f38e0ab0fd443e86a586e16fc802830050253ba28fdab1c2e2b130a6d",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 1 },
    hash: "1239afcc48f5bca6708d32d5fd71ffaae5c529d23ef5cb0c1cd72619502c2118",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 6 },
    hash: "54d8e49d0357632d02d91ade43ff8d6dd6082cac8161f82187e30df37c701951",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 8 },
    hash: "6906bbe39bcd37075b208ebd0b88168a36b0bbbde9b57bf4a610b35234154170",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0, orientation: 9 },
    hash: "25993b8f38e0ab0fd443e86a586e16fc802830050253ba28fdab1c2e2b130a6d",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 0 },
    hash: "25993b8f38e0ab0fd443e86a586e16fc802830050253ba28fdab1c2e2b130a6d",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 1 },
    hash: "1239afcc48f5bca6708d32d5fd71ffaae5c529d23ef5cb0c1cd72619502c2118",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 6 },
    hash: "54d8e49d0357632d02d91ade43ff8d6dd6082cac8161f82187e30df37c701951",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 8 },
    hash: "6906bbe39bcd37075b208ebd0b88168a36b0bbbde9b57bf4a610b35234154170",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 0.4, orientation: 9 },
    hash: "25993b8f38e0ab0fd443e86a586e16fc802830050253ba28fdab1c2e2b130a6d",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 0 },
    hash: "bbc950a424011e76b859cdaba94717007cab81de8a405a7c203d3317d9184c58",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 1 },
    hash: "60c42ee5a2952e48216e502015547dac7064d3d15011c87eaf18b35da05b6516",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 6 },
    hash: "8503737488e636faf98a5078f870fbe251e79074441e4441972c314e539e80e1",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 8 },
    hash: "b9c6ca1ffda35bbaac71a503f2a6be2e72c27afd6ada5f7ee909fd21a17c0b11",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 72.5, orientation: 9 },
    hash: "bbc950a424011e76b859cdaba94717007cab81de8a405a7c203d3317d9184c58",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 0 },
    hash: "16fbd02e3f6861db7a94f55942f262f43eefeb3ebd11503d0e22a0d94484ae47",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 1 },
    hash: "05ffeb0a5f9fadd9d2232bdca175309111a5ab8b188d7605e81823119baf7c9d",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 6 },
    hash: "07ae5952f7db1e4d9eeeb1236f88e27fa4a9fc0e639e7d2f428746e1be0a23fc",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 8 },
    hash: "fede909c97ec69fc8e6909bd5c42933cd865b94325b9a10f98fb9794840b3a03",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 300, orientation: 9 },
    hash: "16fbd02e3f6861db7a94f55942f262f43eefeb3ebd11503d0e22a0d94484ae47",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 0 },
    hash: "b9438cfd906427772fc2bb953fc67f1374114a5f5fa3ca452e0310cd6ec8f0ca",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 1 },
    hash: "5eca712576627a4d470d97bb6ded9686fb40a817acb28ab3319a150095ea8b96",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 6 },
    hash: "0dee6c3aa72a985cd18f8aa09bad7a553c1b6bf1a0f2a05ca9eaa06412e79fff",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 8 },
    hash: "aa926b9a15342dc8b88f426bee401eeb5e9168b98990167b87afcaf7abc21548",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65535, orientation: 9 },
    hash: "b9438cfd906427772fc2bb953fc67f1374114a5f5fa3ca452e0310cd6ec8f0ca",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 0 },
    hash: "bc382176fc33cb226e050bec537467c5a5381e6d59501236b47a5f5385e593c9",
    length: 877,
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
      size: 877
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 1 },
    hash: "ed63a6e42a0f1fac05b7d2bf9d6d6c2fa6963610a14f9f75bb71846f3a9942a4",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 6 },
    hash: "17e4bb7eb9d077ec2af25de900070e32e1bd1c7566786a171f6175b42c9d2cb0",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 8 },
    hash: "424674afd79da900057ed0a7b50e6213aa13e694353d544249273eb2e7271304",
    length: 965,
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
      size: 965
    }
  },
  {
    spec: { width: 9, height: 11, density: 144, orientation: 3 },
    options: { density: 65536, orientation: 9 },
    hash: "bc382176fc33cb226e050bec537467c5a5381e6d59501236b47a5f5385e593c9",
    length: 877,
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
      size: 877
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
