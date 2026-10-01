import assert from "node:assert/strict";
import test from "node:test";
import { crc32 } from "./zip-format.js";
test("ZIP CRC agrees with the standard check vector", () => {
 assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});
