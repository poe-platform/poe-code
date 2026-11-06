import { expect, it } from "vitest";
import { JpegColorEncoding } from "./jpeg-color.js";

it.each([
  { ids: [82, 71, 66], transform: undefined, jfif: false, rgb: true },
  { ids: [1, 2, 3], transform: 0, jfif: false, rgb: true },
  { ids: [82, 71, 66], transform: 1, jfif: false, rgb: false },
  { ids: [82, 71, 66], transform: undefined, jfif: true, rgb: false },
  { ids: [1, 2, 3], transform: undefined, jfif: false, rgb: false },
  { ids: [67, 77, 89, 75], transform: 0, jfif: false, rgb: false }
])("recognizes JPEG color encoding %j", ({ ids, transform, jfif, rgb }) => {
  for (const frameFirst of [false, true]) {
    const encoding = new JpegColorEncoding();
    const frame = Uint8Array.from([8, 0, 13, 0, 17, ids.length, ...ids.flatMap(id => [id, 17, 0])]);
    if (frameFirst) encoding.read(0xc0, frame);
    if (transform !== undefined) encoding.read(0xee, Uint8Array.from([65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, transform]));
    if (jfif) encoding.read(0xe0, Uint8Array.from([74, 70, 73, 70, 0]));
    if (!frameFirst) encoding.read(0xc0, frame);
    expect(encoding.rgb).toBe(rgb);
  }
});
