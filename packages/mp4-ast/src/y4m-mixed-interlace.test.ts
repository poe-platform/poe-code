import assert from "node:assert/strict";
import { it } from "node:test";
import { parseY4m } from "./containers/adapters.js";
import { concatBytes, encodeUtf8 } from "./binary.js";

it("rejects mixed-interlace Y4M input", () => {
  const input = concatBytes([encodeUtf8("YUV4MPEG2 W2 H2 F25:1 Im C420jpeg\nFRAME\n"), new Uint8Array(6).fill(128)]);
  assert.throws(() => parseY4m(input), { message: "YUV4MPEG stream contains mixed interlaced and non-interlaced frames" });
});
