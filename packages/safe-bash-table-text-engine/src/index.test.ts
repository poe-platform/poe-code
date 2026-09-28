import assert from "node:assert/strict";
import { test } from "node:test";
import { settings } from "./table-text/internal.js";
test("table readers enforce configured record ceilings", () => { assert.equal(settings({ limits: { maxRecordBytes: 8 } }).maxRecordBytes, 8); assert.throws(() => settings({ limits: { maxRecordBytes: -1 } }), RangeError); });
