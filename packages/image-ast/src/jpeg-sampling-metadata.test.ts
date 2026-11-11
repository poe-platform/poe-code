import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "./index.js";

for (const jpegProgressive of [false, true]) {
  it.each([undefined, 4])(`retains JPEG sampling metadata when decoding progressive=${jpegProgressive}, shrink=%s`, maxDecodeDimension => {
    const bytes = encodeImage({ width: 16, height: 12, channels: 3, hasAlpha: false, density: 72, format: "png", depth: "uchar", space: "srgb", data: new Uint8Array(16 * 12 * 4).fill(255) }, {
      format: "jpeg", samplingFactor: "2x1", jpegProgressive
    }).data;
    expect(decodeImage(bytes, maxDecodeDimension === undefined ? {} : { maxDecodeDimension })).toMatchObject({ jpegSamplingFactor: "2x1,1x1,1x1" });
  });
}
