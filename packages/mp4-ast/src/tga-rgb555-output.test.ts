import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeTga } from "./containers/tga.js";

// Native FFmpeg 7.0.2 Targa bytes for varied adjacent RGBA pixels, -rle 0.
for (const [width, height, expected] of [
  [64, 8, "f9fa45844cff0b0e6b9c05466fc40cf6477d3a86a7e7ffdc4c4dd39570aef77a"],
  [17, 4, "41fddbcb3d32caf60301aca94c1a574791cfb49cf7e502857377b6badd9c3350"],
  [1, 1, "d73bb5c19fc2554b419fabd992362a09fc61a99e25570a5246057625b349289d"]
] as const) {
  it(`matches native RGB555 conversion for ${width}x${height} RGBA`, () => {
    const data = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 43 % 256);
    const bytes = encodeTga({ width, height, data }, { pixelFormat: "rgb555le", rle: false });
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected);
  });
}
