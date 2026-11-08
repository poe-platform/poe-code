import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createJpegArithmeticEncoder } from "./jpeg-arithmetic.js";

// Native libjpeg-turbo jpegtran -arithmetic reproduced these entropy streams
// byte for byte after decoding the coefficients (32x16, three 1x1 components).
const fixtures = [
  ["zero", "be7d042d00df88ce90cb03225666467fb3b8af8c743d4d0af5f79a8e43ac128c"],
  ["sparse", "2295bd2c33d66577f6b87b45b432ad04d0a32d2c545b86cb6ed2a40323288562"],
  ["dense", "dc8e4152e454417bd8b9d52cc73fbf1e0f84ee43325804cd07bb8dffc8fca304"]
] as const;

for (const [kind, hash] of fixtures) it(`matches native arithmetic entropy for ${kind} coefficients, including reset`, () => {
  const bytes: number[] = [], encoder = createJpegArithmeticEncoder(bytes);
  for (let pass = 0; pass < 2; pass++) {
    const dc = [0, 0, 0];
    for (let block = 0; block < 24; block++) {
      const zz = new Int32Array(64), component = block % 3;
      for (let k = 0; k < 64; k++) {
        if (kind === "dense" || (kind === "sparse" && [0, 1, 5, 63].includes(k))) zz[k] = ((block * 313 + k * 97) % 2047) - 1023;
      }
      encoder.block(zz, dc[component]!, component, true, true);
      dc[component] = zz[0]!;
    }
    encoder.finish();
    expect(createHash("sha256").update(Uint8Array.from(bytes)).digest("hex")).toBe(hash);
    bytes.length = 0;
    encoder.reset();
  }
});
