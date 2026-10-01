import assert from "node:assert/strict";
import test from "node:test";
import { limitsFor } from "./shared.js";
test("network quotas are optional and explicit invalid limits are rejected", () => {
 assert.equal(limitsFor().maxDownloadBytes, Infinity);
 assert.equal(limitsFor({ maxDownloadBytes: 17 }).maxDownloadBytes, 17);
 assert.throws(() => limitsFor({ maxDownloadBytes: -1 }), RangeError);
});
